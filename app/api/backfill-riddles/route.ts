/**
 * app/api/backfill-riddles/route.ts
 *
 * Gap detection for riddle submissions.
 * Uses suix_getDynamicFields on each wallet's UserTasks object to get
 * true on-chain submission count, compares with DB count, saves gaps.
 *
 * Call with: GET /api/backfill-riddles?secret=YOUR_CRON_SECRET
 * Processes WALLETS_PER_RUN wallets per call — run multiple times until done.
 * Progress saved in indexer_checkpoints as 'riddle_backfill_offset'.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const RPC_URL         = process.env.SUI_RPC_URL || 'https://fullnode.mainnet.sui.io:443';
const WALLETS_PER_RUN = 50;
const TIME_BUDGET_MS  = 45_000;

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

function sleep(ms: number) {
  return new Promise<void>(r => setTimeout(r, ms));
}

async function rpcCall<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(RPC_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    cache:   'no-store',
  });
  if (!res.ok) throw new Error(`RPC HTTP ${res.status}`);
  const json = await res.json() as { result?: T; error?: { message: string } };
  if (json.error) throw new Error(`RPC error: ${json.error.message}`);
  return json.result as T;
}

/**
 * Get total count of dynamic fields on a UserTasks object.
 * Each dynamic field = one riddle submission on chain.
 * Paginates through all fields if there are more than 50.
 */
interface DynamicFieldsPage {
  data:        unknown[];
  nextCursor:  string | null;
  hasNextPage: boolean;
}

async function getChainSubmissionCount(objectId: string): Promise<number> {
  let total:  number      = 0;
  let cursor: string | null = null;

  while (true) {
    const result = await rpcCall<DynamicFieldsPage>('suix_getDynamicFields', [
      objectId,
      cursor,
      50,
    ]);

    total += result.data.length;

    if (!result.hasNextPage || !result.nextCursor) break;
    cursor = result.nextCursor;
    await sleep(100);
  }

  return total;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const startMs = Date.now();
  const db      = getDB();

  // ── 1. Get current offset ──────────────────────────────────────────────────
  const { data: cp } = await db
    .from('indexer_checkpoints')
    .select('last_tx_digest')
    .eq('event_type', 'riddle_backfill_offset')
    .maybeSingle();

  const offset = cp?.last_tx_digest ? parseInt(cp.last_tx_digest, 10) : 0;

  // ── 2. Get all wallets that have both riddle_submissions and object_id ──────
  const { data: walletRows, error: walletErr } = await db
    .from('wallet_user_tasks')
    .select('wallet_address, object_id')
    .not('object_id', 'is', null)
    .order('wallet_address');

  if (walletErr) {
    return NextResponse.json({ error: walletErr.message }, { status: 500 });
  }

  // Only process wallets that actually have riddle submissions in DB
  const { data: subWallets } = await db
    .from('riddle_submissions')
    .select('wallet_address');

  const subWalletSet = new Set(
    (subWallets || []).map((r: { wallet_address: string }) => r.wallet_address)
  );

  const allWallets = (walletRows || []).filter(
    (r: { wallet_address: string; object_id: string }) =>
      subWalletSet.has(r.wallet_address)
  ) as Array<{ wallet_address: string; object_id: string }>;

  if (allWallets.length === 0) {
    return NextResponse.json({ done: true, message: 'No wallets to check' });
  }

  const batch = allWallets.slice(offset, offset + WALLETS_PER_RUN);

  if (batch.length === 0) {
    await db.from('indexer_checkpoints')
      .delete().eq('event_type', 'riddle_backfill_offset');
    return NextResponse.json({ done: true, message: 'All wallets checked!' });
  }

  // ── 3. Get DB counts for this batch in one query ───────────────────────────
  const batchAddresses = batch.map(r => r.wallet_address);
  const { data: dbCountRows } = await db
    .from('riddle_submissions')
    .select('wallet_address')
    .in('wallet_address', batchAddresses);

  // Count per wallet from DB
  const dbCounts: Record<string, number> = {};
  for (const row of (dbCountRows || [])) {
    dbCounts[row.wallet_address] = (dbCounts[row.wallet_address] || 0) + 1;
  }

  // ── 4. Process each wallet ─────────────────────────────────────────────────
  const log: Record<string, unknown>[] = [];
  let totalGaps = 0;

  for (const { wallet_address, object_id } of batch) {
    if (Date.now() - startMs > TIME_BUDGET_MS) {
      log.push({ wallet: wallet_address, status: 'time_budget_reached' });
      break;
    }

    try {
      const dbCount    = dbCounts[wallet_address] || 0;
      const chainCount = await getChainSubmissionCount(object_id);
      const gapCount   = chainCount - dbCount;

      if (gapCount > 0) {
        await db.from('riddle_submission_gaps').upsert({
          wallet_address,
          db_count:    dbCount,
          chain_count: chainCount,
          gap_count:   gapCount,
          checked_at:  new Date().toISOString(),
        }, { onConflict: 'wallet_address' });

        totalGaps += gapCount;
        log.push({
          wallet:      wallet_address,
          status:      'gap_found',
          db_count:    dbCount,
          chain_count: chainCount,
          gap_count:   gapCount,
        });
      } else {
        log.push({
          wallet:      wallet_address,
          status:      'ok',
          db_count:    dbCount,
          chain_count: chainCount,
        });
      }

      await sleep(150);

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.push({ wallet: wallet_address, status: 'error', error: msg });
    }
  }

  // ── 5. Save new offset ─────────────────────────────────────────────────────
  const newOffset = offset + batch.length;
  const allDone   = newOffset >= allWallets.length;

  if (allDone) {
    await db.from('indexer_checkpoints')
      .delete().eq('event_type', 'riddle_backfill_offset');
  } else {
    await db.from('indexer_checkpoints').upsert({
      event_type:     'riddle_backfill_offset',
      last_tx_digest: String(newOffset),
      last_event_seq: '0',
      updated_at:     new Date().toISOString(),
    }, { onConflict: 'event_type' });
  }

  return NextResponse.json({
    done:              allDone,
    offset_was:        offset,
    offset_now:        allDone ? 0 : newOffset,
    wallets_total:     allWallets.length,
    wallets_remaining: allDone ? 0 : allWallets.length - newOffset,
    total_gaps_found:  totalGaps,
    elapsed_ms:        Date.now() - startMs,
    log,
  });
}
