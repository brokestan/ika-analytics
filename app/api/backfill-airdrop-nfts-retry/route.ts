/**
 * app/api/backfill-airdrop-nfts-retry/route.ts
 *
 * Targeted retry — only scans 3,460 wallets where
 * SUM(claimed) < allocation_amount.
 * These are the wallets where we're missing claim transactions.
 * Uses per-claim duplicate check so partial claimers are handled safely.
 *
 * GET /api/backfill-airdrop-nfts-retry?secret=X
 * Run until done: true (~35 triggers)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const IKADROP_TYPE    = '0x5a6ae39fd84a871e94c88badc7689debae22119461ba1581f674bfe50acc1271::distribution::IKADrop';
const RPC_URL         = process.env.SUI_RPC_URL || 'https://fullnode.mainnet.sui.io:443';
const CHECKPOINT_KEY  = 'airdrop_nft_backfill_retry_v2';
const WALLETS_PER_RUN = 100;
const MICRO_BATCH     = 5;
const TIME_BUDGET_MS  = 50_000;
const RPC_TIMEOUT_MS  = 30_000;
const MAX_RETRIES     = 1;
const COMPLETED       = 'COMPLETED';

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

interface ClaimRow {
  tx_digest:      string;
  wallet_address: string;
  claimed_amount: number;
  claim_type:     string;
  sbt_id:         string | null;
  claimed_at:     string;
}

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

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

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
      await sleep(500 * Math.pow(2, attempt));
    }
  }
  return null;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const startMs = Date.now();
  const db      = getDB();

  // ── Load checkpoint ──────────────────────────────────────────────────────
  const { data: cp } = await db
    .from('indexer_checkpoints')
    .select('last_tx_digest, last_event_seq')
    .eq('event_type', CHECKPOINT_KEY)
    .single();

  if (cp?.last_tx_digest === COMPLETED) {
    return NextResponse.json({ done: true, status: 'already_complete' });
  }

  const offset = cp?.last_tx_digest
    ? parseInt(cp.last_tx_digest, 10)
    : 0;

  // ── Fetch underclaimed wallets for this run ───────────────────────────────
  // Only wallets where SUM(real claims) < allocation_amount
  // This is the focused 3,460 wallet set — not all 124k
  const { data: pending } = await db.rpc('get_underclaimed_wallets', {
    p_offset: offset,
    p_limit:  WALLETS_PER_RUN,
  });

  if (!pending || pending.length === 0) {
    await db.from('indexer_checkpoints').upsert(
      {
        event_type:     CHECKPOINT_KEY,
        last_tx_digest: COMPLETED,
        last_event_seq: '0',
        updated_at:     new Date().toISOString(),
      },
      { onConflict: 'event_type' }
    );
    return NextResponse.json({
      done:         true,
      status:       'finished',
      final_offset: offset,
      message:      'All underclaimed wallets scanned',
    });
  }

  // ── Pre-load existing real claims for duplicate prevention ────────────────
  // Per-claim check so partial claimers are handled correctly —
  // only missing individual claim entries get written, not whole wallets
  const allAddresses = (pending as WalletRow[]).map(w => w.wallet_address);

  const { data: existingRealClaims } = await db
    .from('airdrop_claims')
    .select('wallet_address, claimed_amount, claimed_at')
    .in('wallet_address', allAddresses)
    .not('tx_digest', 'like', '%:%');

  const existingClaimsMap = new Map<string, Array<{ claimed_amount: number; claim_minute: string }>>();
  for (const row of existingRealClaims ?? []) {
    const minute = (row.claimed_at as string).substring(0, 16);
    if (!existingClaimsMap.has(row.wallet_address)) {
      existingClaimsMap.set(row.wallet_address, []);
    }
    existingClaimsMap.get(row.wallet_address)!.push({
      claimed_amount: Number(row.claimed_amount),
      claim_minute:   minute,
    });
  }

  // ── Process in micro-batches ─────────────────────────────────────────────
  const wallets       = pending as WalletRow[];
  let   processed     = 0;
  let   totalClaims   = 0;
  let   totalNFTs     = 0;
  let   resolved      = 0;
  let   stillNull     = 0;
  let   batchesRun    = 0;
  let   currentOffset = offset;

  for (let i = 0; i < wallets.length; i += MICRO_BATCH) {
    if (Date.now() - startMs > TIME_BUDGET_MS) {
      console.log(`[retry-v2] Time budget hit after ${batchesRun} batches`);
      break;
    }

    const batch = wallets.slice(i, i + MICRO_BATCH);

    const results = await Promise.allSettled(
      batch.map(row =>
        fetchIKADropNFT(row.wallet_address).then(nft => ({
          nft,
          wallet: row.wallet_address,
        }))
      )
    );

    const nftUpdates: Array<{ wallet_address: string; nft_object_id: string }> = [];
    const newClaims:  ClaimRow[] = [];

    for (const r of results) {
      if (r.status === 'rejected') { stillNull++; continue; }

      const { nft, wallet } = r.value;
      if (!nft) { stillNull++; continue; }

      resolved++;

      // Track object ID
      nftUpdates.push({
        wallet_address: wallet,
        nft_object_id:  nft.objectId,
      });

      if (nft.claimHistory.length > 0 && nft.claimed > 0) {
        const existingForWallet = existingClaimsMap.get(wallet) ?? [];

        for (const h of nft.claimHistory) {
          const claimedAt   = new Date(parseInt(h.timestamp_ms)).toISOString();
          const claimMinute = claimedAt.substring(0, 16);
          const claimedAmt  = Number(h.claimed) / 1e9;

          // Only write if this specific claim doesn't already exist
          const isDuplicate = existingForWallet.some(
            e => e.claimed_amount === claimedAmt &&
                 e.claim_minute   === claimMinute
          );

          if (!isDuplicate) {
            newClaims.push({
              tx_digest:      `${nft.objectId}:${h.timestamp_ms}`,
              wallet_address: wallet,
              claimed_amount: claimedAmt,
              claim_type:     h.human_id_sbt_id ? 'claim_sbt' : 'claim',
              sbt_id:         h.human_id_sbt_id ?? null,
              claimed_at:     claimedAt,
            });
          }
        }
      }
    }

    processed   += batch.length;
    totalNFTs   += nftUpdates.length;
    totalClaims += newClaims.length;
    batchesRun++;

    const writes: PromiseLike<unknown>[] = [];

    if (nftUpdates.length > 0) {
      for (const ch of chunk(nftUpdates, 50)) {
        writes.push(
          db.from('airdrop_allocations')
            .upsert(ch, { onConflict: 'wallet_address' })
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

    await Promise.allSettled(writes);

    // Mid-run checkpoint
    currentOffset = offset + processed;
    await db.from('indexer_checkpoints').upsert(
      {
        event_type:     CHECKPOINT_KEY,
        last_tx_digest: String(currentOffset),
        last_event_seq: '0',
        updated_at:     new Date().toISOString(),
      },
      { onConflict: 'event_type' }
    );

    const remainingMs = TIME_BUDGET_MS - (Date.now() - startMs);
    if (remainingMs > 1000) await sleep(200);
  }

  // Check how many underclaimed wallets remain after this run
  const { data: remaining } = await db.rpc('get_underclaimed_wallets', {
    p_offset: 0,
    p_limit:  1,
  });

  return NextResponse.json({
    done:            false,
    status:          'retry_in_progress',
    offset_was:      offset,
    offset_now:      currentOffset,
    processed:       processed,
    resolved:        resolved,
    still_null:      stillNull,
    new_claims:      totalClaims,
    nft_updates:     totalNFTs,
    elapsed_ms:      Date.now() - startMs,
  });
}
