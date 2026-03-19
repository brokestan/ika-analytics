/**
 * app/api/backfill-riddles/route.ts
 *
 * Gap detection for riddle submissions.
 * For each wallet, fetches object changes from their tx digests in riddle_submissions,
 * finds the created dynamic field object (submission counter), reads its name (= submission number),
 * compares max(name) on-chain vs our DB count, saves gaps to riddle_submission_gaps.
 *
 * Call with: GET /api/backfill-riddles?secret=YOUR_CRON_SECRET
 * Processes WALLETS_PER_RUN wallets per call — run multiple times until done.
 * Progress is saved in indexer_checkpoints as 'riddle_backfill_offset'.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const RPC_URL        = process.env.SUI_RPC_URL || 'https://fullnode.mainnet.sui.io:443';
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

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Given tx digests, fetch object changes and find the created
 * dynamic field object (type contains dynamic_field::Field<u64)
 * Returns map of txDigest -> { objectId, name (submission number) }
 */
async function fetchSubmissionCounters(
  txDigests: string[]
): Promise<Record<string, number>> {
  if (txDigests.length === 0) return {};

  // Step 1: get object changes to find created dynamic field object IDs
  const txResults = await rpcCall<Array<{
    objectChanges?: Array<{
      type:        string;
      objectType?: string;
      objectId?:   string;
    }>;
  } | null>>('sui_multiGetTransactionBlocks', [
    txDigests,
    { showObjectChanges: true, showInput: false, showEffects: false, showEvents: false },
  ]);

  // Map txDigest -> created dynamic field objectId
  const txToObjectId: Record<string, string> = {};
  for (let i = 0; i < txDigests.length; i++) {
    const changes = txResults[i]?.objectChanges ?? [];
    const created = changes.find(c =>
      c.type === 'created' &&
      c.objectType?.includes('dynamic_field::Field')
    );
    if (created?.objectId) {
      txToObjectId[txDigests[i]] = created.objectId;
    }
  }

  const objectIds = Object.values(txToObjectId);
  if (objectIds.length === 0) return {};

  // Step 2: fetch those objects to read name field (= submission number)
  const objResults = await rpcCall<Array<{
    data?: {
      objectId: string;
      content?: {
        fields?: {
          name?: string | number;
        };
      };
    };
  } | null>>('sui_multiGetObjects', [
    objectIds,
    { showContent: true },
  ]);

  // Map objectId -> submission number
  const objectIdToNumber: Record<string, number> = {};
  for (const obj of objResults) {
    const objectId = obj?.data?.objectId;
    const name     = obj?.data?.content?.fields?.name;
    if (objectId && name !== undefined) {
      objectIdToNumber[objectId] = parseInt(String(name), 10);
    }
  }

  // Map txDigest -> submission number
  const txToNumber: Record<string, number> = {};
  for (const [txDigest, objectId] of Object.entries(txToObjectId)) {
    const num = objectIdToNumber[objectId];
    if (num !== undefined) txToNumber[txDigest] = num;
  }

  return txToNumber;
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
    .single();

  const offset = cp?.last_tx_digest ? parseInt(cp.last_tx_digest, 10) : 0;

  // ── 2. Get all distinct wallets from riddle_submissions ────────────────────
  const { data: walletRows, error: walletErr } = await db
    .from('riddle_submissions')
    .select('wallet_address')
    .order('wallet_address');

  if (walletErr) {
    return NextResponse.json({ error: walletErr.message }, { status: 500 });
  }

  // Deduplicate wallets
  const allWallets = [...new Set(
    (walletRows || []).map((r: { wallet_address: string }) => r.wallet_address)
  )];

  if (allWallets.length === 0) {
    return NextResponse.json({ done: true, message: 'No wallets found' });
  }

  const batch = allWallets.slice(offset, offset + WALLETS_PER_RUN);

  if (batch.length === 0) {
    await db.from('indexer_checkpoints')
      .delete().eq('event_type', 'riddle_backfill_offset');
    return NextResponse.json({ done: true, message: 'All wallets checked!' });
  }

  // ── 3. Process each wallet ─────────────────────────────────────────────────
  const log: Record<string, unknown>[] = [];
  let totalGaps = 0;

  for (const wallet of batch) {
    if (Date.now() - startMs > TIME_BUDGET_MS) {
      log.push({ wallet, status: 'time_budget_reached' });
      break;
    }

    try {
      // Get all tx digests for this wallet from our DB
      const { data: txRows } = await db
        .from('riddle_submissions')
        .select('tx_digest')
        .eq('wallet_address', wallet);

      const txDigests = (txRows || []).map((r: { tx_digest: string }) => r.tx_digest);
      const dbCount   = txDigests.length;

      if (dbCount === 0) {
        log.push({ wallet, status: 'no_txs' });
        continue;
      }

      // Fetch submission counter objects from all txs in batches of 50
      const txToNumber: Record<string, number> = {};
      for (const txBatch of chunk(txDigests, 50)) {
        const result = await fetchSubmissionCounters(txBatch);
        Object.assign(txToNumber, result);
        await sleep(200);
      }

      // Find max submission number = true chain count
      const numbers   = Object.values(txToNumber).filter(n => !isNaN(n));
      const chainCount = numbers.length > 0 ? Math.max(...numbers) : dbCount;
      const gapCount   = chainCount - dbCount;

      if (gapCount > 0) {
        // Save gap to DB
        await db.from('riddle_submission_gaps').upsert({
          wallet_address: wallet,
          db_count:       dbCount,
          chain_count:    chainCount,
          gap_count:      gapCount,
          checked_at:     new Date().toISOString(),
        }, { onConflict: 'wallet_address' });

        totalGaps += gapCount;
        log.push({
          wallet,
          status:      'gap_found',
          db_count:    dbCount,
          chain_count: chainCount,
          gap_count:   gapCount,
        });
      } else {
        log.push({
          wallet,
          status:      'ok',
          db_count:    dbCount,
          chain_count: chainCount,
        });
      }

      await sleep(200);

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.push({ wallet, status: 'error', error: msg });
    }
  }

  // ── 4. Save new offset ─────────────────────────────────────────────────────
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
