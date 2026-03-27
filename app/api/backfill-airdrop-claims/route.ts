// app/api/backfill-airdrop-claims/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { fetchAirdropClaims } from '@/lib/sui-rpc';

const PAGES_PER_RUN  = 10;
const TIME_BUDGET_MS = 45_000;
const BATCH_SIZE     = 100;

function getDB() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,   // use consistent env var
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

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function processClaims(
  db: ReturnType<typeof getDB>,
  claimType: 'claim' | 'claim_sbt',
  checkpointKey: string,
  startMs: number
): Promise<{ count: number; skipped: number; pages: number; done: boolean }> {
  const { data: cp } = await db
    .from('indexer_checkpoints')
    .select('last_tx_digest, last_event_seq')
    .eq('event_type', checkpointKey)
    .single();

  let cursor = cp?.last_tx_digest
    ? { txDigest: cp.last_tx_digest, eventSeq: cp.last_event_seq || '0' }
    : null;

  let totalInserted = 0;
  let totalSkipped  = 0;
  let pages = 0;

  while (pages < PAGES_PER_RUN) {
    if (Date.now() - startMs > TIME_BUDGET_MS) break;

    const page = await fetchAirdropClaims(claimType, cursor);

    if (page.data.length > 0) {
      const rows = page.data.map((c: any) => ({
        tx_digest:      c.tx_digest,
        wallet_address: c.wallet_address,
        claimed_amount: c.claimed_amount,
        claim_type:     c.claim_type,
        sbt_id:         c.sbt_id,
        claimed_at:     c.claimed_at,
      }));

      // Skip already indexed digests
      const digests = rows.map(r => r.tx_digest);
      let existing: any[] = [];
      if (digests.length > 0) {
        const { data } = await db
          .from('airdrop_claims')
          .select('tx_digest')
          .in('tx_digest', digests);
        existing = data || [];
      }

      const existingSet = new Set(existing.map(e => e.tx_digest));
      const newRows = rows.filter(r => !existingSet.has(r.tx_digest));
      totalSkipped += rows.length - newRows.length;

      if (newRows.length > 0) {
        for (const b of chunk(newRows, BATCH_SIZE)) {
          await db.from('airdrop_claims')
            .upsert(b, { onConflict: 'tx_digest', ignoreDuplicates: true });
        }
        totalInserted += newRows.length;
      }
    }

    pages++;

    if (page.nextCursor) {
      await db.from('indexer_checkpoints').upsert(
        {
          event_type:     checkpointKey,
          last_tx_digest: page.nextCursor.txDigest,
          last_event_seq: page.nextCursor.eventSeq,
          updated_at:     new Date().toISOString(),
        },
        { onConflict: 'event_type' }
      );
      cursor = page.nextCursor;
    }

    if (!page.hasNextPage) {
      await db.from('indexer_checkpoints')
        .delete().eq('event_type', checkpointKey);
      return { count: totalInserted, skipped: totalSkipped, pages, done: true };
    }
  }

  return { count: totalInserted, skipped: totalSkipped, pages, done: false };
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const startMs = Date.now();
  const db      = getDB();

  const [claimResult, claimSbtResult] = await Promise.all([
    processClaims(db, 'claim',     'airdrop_claim_txs',     startMs),
    processClaims(db, 'claim_sbt', 'airdrop_claim_sbt_txs', startMs),
  ]);

  const allDone = claimResult.done && claimSbtResult.done;

  return NextResponse.json({
    done:          allDone,
    claims:        claimResult,
    claims_sbt:    claimSbtResult,
    elapsed_ms:    Date.now() - startMs,
  });
}
