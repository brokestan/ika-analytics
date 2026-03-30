/**
 * app/api/backfill-airdrop-nfts/route.ts
 *
 * v2 — scans ALL 124k allocated wallets (claimed + unclaimed).
 * Reads claim_history from each wallet's IKADrop NFT object.
 * This is ground truth — immune to suix_queryTransactionBlocks pagination gaps.
 *
 * GET /api/backfill-airdrop-nfts?secret=X
 * Run until done: true
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// ─── Constants ────────────────────────────────────────────────────────────────

const IKADROP_TYPE    = '0x5a6ae39fd84a871e94c88badc7689debae22119461ba1581f674bfe50acc1271::distribution::IKADrop';
const RPC_URL         = process.env.SUI_RPC_URL || 'https://fullnode.mainnet.sui.io:443';
const CHECKPOINT_KEY  = 'airdrop_nft_backfill_v2'; // fresh key — v1 covered 52k unclaimed
const WALLETS_PER_RUN = 400;
const MICRO_BATCH     = 15;
const TIME_BUDGET_MS  = 50_000;
const RPC_TIMEOUT_MS  = 8_000;
const MAX_RETRIES     = 2;
const COMPLETED       = 'COMPLETED';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ClaimEntry {
  claimed:         string;
  timestamp_ms:    string;
  human_id_sbt_id: string | null;
}

interface NFTResult {
  objectId:     string;
  claimed:      number;
  claimHistory: ClaimEntry[];
}

interface WalletRow {
  wallet_address: string;
}

interface NFTUpdateRow {
  wallet_address: string;
  nft_object_id:  string;
}

interface ClaimRow {
  tx_digest:      string;
  wallet_address: string;
  claimed_amount: number;
  claim_type:     string;
  sbt_id:         string | null;
  claimed_at:     string;
}

interface MicroBatchResult {
  nftUpdates: NFTUpdateRow[];
  newClaims:  ClaimRow[];
  nullCount:  number;
}

// ─── DB ───────────────────────────────────────────────────────────────────────

function getDB() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const auth = req.headers.get('authorization') || '';
  const qs   = req.nextUrl.searchParams.get('secret') || '';
  return auth === `Bearer ${secret}` || qs === secret;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise<void>(r => setTimeout(r, ms));
}

// ─── RPC ──────────────────────────────────────────────────────────────────────

async function rpcCall<T>(method: string, params: unknown[]): Promise<T> {
  const controller = new AbortController();
  const timer      = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS);
  try {
    const res = await fetch(RPC_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      cache:   'no-store',
      signal:  controller.signal,
    });
    if (!res.ok) throw new Error(`RPC HTTP ${res.status}`);
    const json = await res.json() as { result?: T; error?: { message: string } };
    if (json.error) throw new Error(`RPC error: ${json.error.message}`);
    return json.result as T;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Fetch single wallet NFT (with retry + timeout) ───────────────────────────

async function fetchIKADropNFT(walletAddress: string): Promise<NFTResult | null> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = await rpcCall<{
        data: Array<{
          data?: {
            objectId: string;
            content?: {
              fields?: {
                claimed?:       string;
                claim_history?: Array<{
                  fields?: {
                    claimed?:          string;
                    timestamp_ms?:     string;
                    human_id_sbt_id?:  string | null;
                  };
                }>;
              };
            };
          };
        }>;
      }>('suix_getOwnedObjects', [
        walletAddress,
        {
          filter:  { StructType: IKADROP_TYPE },
          options: { showContent: true },
        },
        null,
        5,
      ]);

      const obj = result.data?.[0]?.data;
      if (!obj) return null;

      const fields       = obj.content?.fields;
      const claimed      = Number(fields?.claimed ?? 0);
      const claimHistory = (fields?.claim_history ?? []).map(h => ({
        claimed:         h.fields?.claimed          ?? '0',
        timestamp_ms:    h.fields?.timestamp_ms     ?? '0',
        human_id_sbt_id: h.fields?.human_id_sbt_id  ?? null,
      }));

      return { objectId: obj.objectId, claimed, claimHistory };
    } catch (err) {
      const isAbort = err instanceof Error && err.name === 'AbortError';
      if (isAbort || attempt === MAX_RETRIES) return null;
      await sleep(200 * Math.pow(2, attempt));
    }
  }
  return null;
}

// ─── Process a micro-batch of wallets concurrently ────────────────────────────

async function processMicroBatch(wallets: WalletRow[]): Promise<MicroBatchResult> {
  const results = await Promise.allSettled(
    wallets.map(row =>
      fetchIKADropNFT(row.wallet_address).then(nft => ({
        nft,
        wallet: row.wallet_address,
      }))
    )
  );

  const nftUpdates: NFTUpdateRow[] = [];
  const newClaims:  ClaimRow[]     = [];
  let   nullCount = 0;

  for (const r of results) {
    if (r.status === 'rejected') { nullCount++; continue; }

    const { nft, wallet } = r.value;
    if (!nft) { nullCount++; continue; }

    if (nft.objectId) {
      nftUpdates.push({
        wallet_address: wallet,
        nft_object_id:  nft.objectId,
      });
    }

    // Only write claim rows if the NFT actually has claim history
    // claimed > 0 guards against NFT objects that exist but were never used
    if (nft.claimHistory.length > 0 && nft.claimed > 0) {
      for (const h of nft.claimHistory) {
        newClaims.push({
          // Synthetic stable key — same wallet scanned twice = identical key = no-op upsert
          tx_digest:      `${nft.objectId}:${h.timestamp_ms}`,
          wallet_address: wallet,
          // Consistent with fetchAirdropClaims in sui-rpc.ts — both divide raw u64 by 1e9
          claimed_amount: Number(h.claimed) / 1e9,
          claim_type:     h.human_id_sbt_id ? 'claim_sbt' : 'claim',
          sbt_id:         h.human_id_sbt_id ?? null,
          claimed_at:     new Date(parseInt(h.timestamp_ms)).toISOString(),
        });
      }
    }
  }

  return { nftUpdates, newClaims, nullCount };
}

// ─── Bulk DB writes ───────────────────────────────────────────────────────────

async function flushToDB(
  db:         ReturnType<typeof getDB>,
  nftUpdates: NFTUpdateRow[],
  newClaims:  ClaimRow[]
): Promise<void> {
  const writes: PromiseLike<unknown>[] = [];

  if (nftUpdates.length > 0) {
    const CHUNK = 50;
    for (let i = 0; i < nftUpdates.length; i += CHUNK) {
      writes.push(
        db.from('airdrop_allocations')
          .upsert(nftUpdates.slice(i, i + CHUNK), { onConflict: 'wallet_address' })
          .then(r => { if (r.error) throw new Error(r.error.message); return r; })
      );
    }
  }

  if (newClaims.length > 0) {
    writes.push(
      db.from('airdrop_claims')
        .upsert(newClaims, { onConflict: 'tx_digest', ignoreDuplicates: true })
        .then(r => { if (r.error) throw new Error(r.error.message); return r; })
    );
  }

  // allSettled — never throws. Upserts are idempotent so partial flush
  // is always safe to retry on the next trigger.
  await Promise.allSettled(writes);
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const startMs = Date.now();
  const db      = getDB();

  // ── Load checkpoint ─────────────────────────────────────────────────────────
  const { data: cp } = await db
    .from('indexer_checkpoints')
    .select('last_tx_digest, last_event_seq')
    .eq('event_type', CHECKPOINT_KEY)
    .single();

  if (cp?.last_tx_digest === COMPLETED) {
    return NextResponse.json({ done: true, status: 'already_complete' });
  }

  const offset      = cp?.last_tx_digest ? parseInt(cp.last_tx_digest, 10) : 0;
  const prevSkipped = cp?.last_event_seq  ? parseInt(cp.last_event_seq,  10) : 0;

  // ── Fetch all allocated wallets for this run ─────────────────────────────
  // get_all_airdrop_wallets returns claimed + unclaimed.
  // Unclaimed wallets return null from RPC (no NFT found) — fast and harmless.
  // Claimed wallets return their NFT's claim_history — ground truth for the gap.
  const { data: missing } = await db.rpc('get_all_airdrop_wallets', {
    p_offset: offset,
    p_limit:  WALLETS_PER_RUN,
  });

  if (!missing || missing.length === 0) {
    await db.from('indexer_checkpoints').upsert(
      {
        event_type:     CHECKPOINT_KEY,
        last_tx_digest: COMPLETED,
        last_event_seq: String(prevSkipped),
        updated_at:     new Date().toISOString(),
      },
      { onConflict: 'event_type' }
    );
    return NextResponse.json({
      done:          true,
      status:        'finished',
      final_offset:  offset,
      total_skipped: prevSkipped,
    });
  }

  // ── Process in micro-batches ─────────────────────────────────────────────
  const wallets       = missing as WalletRow[];
  let   processed     = 0;
  let   totalClaims   = 0;
  let   totalNFTs     = 0;
  let   totalNulls    = 0;
  let   batchesRun    = 0;
  let   currentOffset = offset;

  for (let i = 0; i < wallets.length; i += MICRO_BATCH) {
    if (Date.now() - startMs > TIME_BUDGET_MS) {
      console.log(`[backfill-v2] Time budget hit — resuming at offset ${currentOffset}`);
      break;
    }

    const batch = wallets.slice(i, i + MICRO_BATCH);
    const { nftUpdates, newClaims, nullCount } = await processMicroBatch(batch);

    processed   += batch.length;
    totalNFTs   += nftUpdates.length;
    totalClaims += newClaims.length;
    totalNulls  += nullCount;
    batchesRun++;

    await flushToDB(db, nftUpdates, newClaims);

    // Mid-run checkpoint — survives Vercel kills, at most 10 wallets re-processed
    currentOffset = offset + processed;
    await db.from('indexer_checkpoints').upsert(
      {
        event_type:     CHECKPOINT_KEY,
        last_tx_digest: String(currentOffset),
        last_event_seq: String(prevSkipped + totalNulls),
        updated_at:     new Date().toISOString(),
      },
      { onConflict: 'event_type' }
    );

    const remainingMs = TIME_BUDGET_MS - (Date.now() - startMs);
    if (remainingMs > 500) await sleep(100);
  }

  const notReachedThisRun = wallets.length - processed;

  return NextResponse.json({
    done:                 false,
    status:               'in_progress',
    offset_was:           offset,
    offset_now:           currentOffset,
    processed_this_run:   processed,
    not_reached_this_run: notReachedThisRun,
    batches_run:          batchesRun,
    new_claims:           totalClaims,
    nft_updates:          totalNFTs,
    nulls_this_run:       totalNulls,
    cumulative_skipped:   prevSkipped + totalNulls,
    elapsed_ms:           Date.now() - startMs,
  });
}
