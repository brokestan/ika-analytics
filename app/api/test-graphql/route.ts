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

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const stream = req.nextUrl.searchParams.get('stream') as KnownStream | null;
  if (!stream || !KNOWN_STREAMS.includes(stream)) {
    return NextResponse.json(
      { error: `stream must be one of: ${KNOWN_STREAMS.join(', ')}` },
      { status: 400 }
    );
  }

  const db = getDB();
  const { data: cp, error: cpErr } = await db
    .from('indexer_checkpoints')
    .select('last_checkpoint_number, last_tx_digest')
    .eq('event_type', stream)
    .single();

  if (cpErr || !cp?.last_checkpoint_number) {
    return NextResponse.json(
      { error: 'no last_checkpoint_number saved for this stream yet — run the checkpoint-number backfill first' },
      { status: 400 }
    );
  }

  try {
    const page = stream === 'lock_events'
      ? await fetchLockStakeEventsGraphQL(null, cp.last_checkpoint_number)
      : stream === 'unlock_events'
      ? await fetchUnlockEventsGraphQL(null, cp.last_checkpoint_number)
      : stream === 'isui_lock_events'
      ? await fetchISUILockEventsGraphQL(null, cp.last_checkpoint_number)
      : await fetchISUIUnlockEventsGraphQL(null, cp.last_checkpoint_number);

    // For lock-type streams, also test the duration enrichment on a small
    // sample (not the whole page) so this stays a quick, cheap dry run.
    let durationsSample: Record<string, number> | null = null;
    if ((stream === 'lock_events' || stream === 'isui_lock_events') && page.data.length > 0) {
      const sampleDigests = page.data.slice(0, 5).map((d: any) => d.txDigest);
      durationsSample = await fetchDurationsForBatchGraphQL(sampleDigests);
    }

    // Write the sample into the staging table — ONLY the staging table,
    // never any real production table — so you can compare it against
    // what's already stored using plain SQL, not just eyeballing JSON.
    const sample = page.data.slice(0, 5);
    if (sample.length > 0) {
      const rows = sample.map((row: any) => ({
        stream,
        tx_digest: row.txDigest,
        payload: row,
      }));
      const { error: insertErr } = await db.from('graphql_test_results').insert(rows);
      if (insertErr) {
        return NextResponse.json({
          warning: 'Fetched fine, but failed to write to graphql_test_results — did you run the CREATE TABLE first?',
          insert_error: insertErr.message,
          sample_rows: sample,
        });
      }
    }

    return NextResponse.json({
      stream,
      bootstrap_checkpoint_used: cp.last_checkpoint_number,
      last_known_digest_from_json_rpc_era: cp.last_tx_digest,
      count_returned: page.data.length,
      has_next_page: page.hasNextPage,
      next_cursor: page.nextCursor,
      sample_rows: sample,
      duration_sample: durationsSample,
      note: 'Real production tables were never touched. Sample rows were written to graphql_test_results for SQL comparison — drop or truncate that table once you\'re done.',
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
