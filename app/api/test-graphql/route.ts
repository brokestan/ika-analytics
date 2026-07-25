/*
 * app/api/test-graphql/route.ts
 *
 * Read-only dry run for the GraphQL migration. Calls the new GraphQL fetch
 * functions and reports exactly what came back — never writes to Supabase,
 * never touches indexer_checkpoints, never advances anything. Safe to hit
 * repeatedly, safe to hit against production data, safe to leave deployed.
 *
 * GET /api/test-graphql?stream=lock_events&secret=YOUR_CRON_SECRET
 * GET /api/test-graphql?stream=unlock_events&secret=YOUR_CRON_SECRET
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  fetchLockStakeEventsGraphQL,
  fetchUnlockEventsGraphQL,
  fetchISUILockEventsGraphQL,
  fetchISUIUnlockEventsGraphQL,
  fetchDurationsForBatchGraphQL,
} from '@/lib/sui-graphql';

function getDB() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const auth = req.headers.get('authorization') || '';
  const qs   = req.nextUrl.searchParams.get('secret') || '';
  return auth === `Bearer ${secret}` || qs === secret;
}

const KNOWN_STREAMS = ['lock_events', 'unlock_events', 'isui_lock_events', 'isui_unlock_events'] as const;
type KnownStream = typeof KNOWN_STREAMS[number];

async function runStream(db: ReturnType<typeof getDB>, stream: KnownStream) {
  const { data: cp, error: cpErr } = await db
    .from('indexer_checkpoints')
    .select('last_checkpoint_number, last_tx_digest')
    .eq('event_type', stream)
    .single();

  if (cpErr || !cp?.last_checkpoint_number) {
    return { stream, error: 'no last_checkpoint_number saved for this stream yet' };
  }

  try {
    const page = stream === 'lock_events'
      ? await fetchLockStakeEventsGraphQL(null, cp.last_checkpoint_number)
      : stream === 'unlock_events'
      ? await fetchUnlockEventsGraphQL(null, cp.last_checkpoint_number)
      : stream === 'isui_lock_events'
      ? await fetchISUILockEventsGraphQL(null, cp.last_checkpoint_number)
      : await fetchISUIUnlockEventsGraphQL(null, cp.last_checkpoint_number);

    // Only IKA locks ever get a duration lookup in production — iSUI locks
    // are always hardcoded to 0, so testing duration for them would just be
    // noise, not a real check.
    let durationsSample: Record<string, number> | null = null;
    if (stream === 'lock_events' && page.data.length > 0) {
      const sampleDigests = page.data.slice(0, 5).map((d: any) => d.txDigest);
      durationsSample = await fetchDurationsForBatchGraphQL(sampleDigests);
    }

    const sample = page.data.slice(0, 5);
    if (sample.length > 0) {
      const rows = sample.map((row: any) => ({ stream, tx_digest: row.txDigest, payload: row }));
      await db.from('graphql_test_results').insert(rows);
    }

    return {
      stream,
      bootstrap_checkpoint_used: cp.last_checkpoint_number,
      last_known_digest_from_json_rpc_era: cp.last_tx_digest,
      count_returned: page.data.length,
      has_next_page: page.hasNextPage,
      next_cursor: page.nextCursor,
      sample_rows: sample,
      duration_sample: durationsSample,
    };
  } catch (err) {
    return { stream, error: (err as Error).message };
  }
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const requested = req.nextUrl.searchParams.get('stream');
  const db = getDB();

  // No stream param, or stream=all -> run every known stream in one go.
  if (!requested || requested === 'all') {
    const results = [];
    for (const s of KNOWN_STREAMS) {
      results.push(await runStream(db, s));
    }
    return NextResponse.json({
      results,
      note: 'Real production tables were never touched. Sample rows were written to graphql_test_results for SQL comparison — drop or truncate that table once you\'re done.',
    });
  }

  if (!KNOWN_STREAMS.includes(requested as KnownStream)) {
    return NextResponse.json(
      { error: `stream must be "all" or one of: ${KNOWN_STREAMS.join(', ')}` },
      { status: 400 }
    );
  }

  const result = await runStream(db, requested as KnownStream);
  return NextResponse.json({
    ...result,
    note: 'Real production tables were never touched. Sample rows were written to graphql_test_results for SQL comparison — drop or truncate that table once you\'re done.',
  });
}
