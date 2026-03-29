/**
 * app/api/backfill-airdrop-nfts/route.ts
 *
 * Fetches IKADrop NFT objects directly for wallets missing from airdrop_claims.
 * Bypasses the RPC pagination gap entirely.
 *
 * GET /api/backfill-airdrop-nfts?secret=X
 * Run until done: true
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const IKADROP_TYPE   = '0x5a6ae39fd84a871e94c88badc7689debae22119461ba1581f674bfe50acc1271::distribution::IKADrop';
const RPC_URL        = process.env.SUI_RPC_URL || 'https://fullnode.mainnet.sui.io:443';
const WALLETS_PER_RUN = 200;
const TIME_BUDGET_MS  = 55_000;
const COMPLETED       = 'COMPLETED';

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

async function fetchIKADropNFT(walletAddress: string): Promise<{
  objectId:      string;
  claimed:       number;
  claimHistory:  Array<{ claimed: string; timestamp_ms: string; human_id_sbt_id: string | null }>;
} | null> {
  try {
    const result = await rpcCall<{
      data: Array<{
        data?: {
          objectId: string;
          content?: {
            fields?: {
              claimed?:        string;
              claim_history?:  Array<{
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

    const fields      = obj.content?.fields;
    const claimed     = Number(fields?.claimed ?? 0);
    const claimHistory = (fields?.claim_history ?? []).map(h => ({
      claimed:          h.fields?.claimed          ?? '0',
      timestamp_ms:     h.fields?.timestamp_ms     ?? '0',
      human_id_sbt_id:  h.fields?.human_id_sbt_id  ?? null,
    }));

    return { objectId: obj.objectId, claimed, claimHistory };
  } catch {
    return null;
  }
}

function sleep(ms: number) {
  return new Promise<void>(r => setTimeout(r, ms));
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const startMs = Date.now();
  const db      = getDB();

  // Check completed sentinel
  const { data: cp } = await db
    .from('indexer_checkpoints')
    .select('last_tx_digest')
    .eq('event_type', 'airdrop_nft_backfill')
    .single();

  if (cp?.last_tx_digest === COMPLETED) {
    return NextResponse.json({ done: true, status: 'already_complete' });
  }

  const offset = cp?.last_tx_digest ? parseInt(cp.last_tx_digest, 10) : 0;

  // Get wallets not yet in airdrop_claims
  const { data: missing } = await db.rpc('get_unclaimed_airdrop_wallets', {
    p_offset: offset,
    p_limit:  WALLETS_PER_RUN,
  });

  if (!missing || missing.length === 0) {
    await db.from('indexer_checkpoints').upsert(
      { event_type: 'airdrop_nft_backfill', last_tx_digest: COMPLETED, last_event_seq: '0', updated_at: new Date().toISOString() },
      { onConflict: 'event_type' }
    );
    return NextResponse.json({ done: true, status: 'finished', offset });
  }

  let newClaims   = 0;
  let nftUpdates  = 0;
  let processed   = 0;

  for (const row of missing as Array<{ wallet_address: string }>) {
    if (Date.now() - startMs > TIME_BUDGET_MS) break;

    const nft = await fetchIKADropNFT(row.wallet_address);
    processed++;

    if (!nft) {
      await sleep(100);
      continue;
    }

    // Save NFT object ID back to allocations
    if (nft.objectId) {
      await db.from('airdrop_allocations')
        .update({ nft_object_id: nft.objectId })
        .eq('wallet_address', row.wallet_address);
      nftUpdates++;
    }

    // If NFT has claim history — this wallet claimed but was missing from our DB
    if (nft.claimHistory.length > 0 && nft.claimed > 0) {
      for (const h of nft.claimHistory) {
        const claimType = h.human_id_sbt_id ? 'claim_sbt' : 'claim';
        const claimedAt = new Date(parseInt(h.timestamp_ms)).toISOString();

        await db.from('airdrop_claims').upsert(
          {
            // Use NFT objectId + timestamp as synthetic key since we don't have tx_digest here
            tx_digest:      `${nft.objectId}:${h.timestamp_ms}`,
            wallet_address: row.wallet_address,
            claimed_amount: Number(h.claimed) / 1e9,
            claim_type:     claimType,
            sbt_id:         h.human_id_sbt_id ?? null,
            claimed_at:     claimedAt,
          },
          { onConflict: 'tx_digest', ignoreDuplicates: true }
        );
        newClaims++;
      }
    }

    await sleep(150); // be kind to RPC
  }

  // Save new offset
  const newOffset = offset + processed;
  await db.from('indexer_checkpoints').upsert(
    {
      event_type:     'airdrop_nft_backfill',
      last_tx_digest: String(newOffset),
      last_event_seq: '0',
      updated_at:     new Date().toISOString(),
    },
    { onConflict: 'event_type' }
  );

  return NextResponse.json({
    done:        false,
    status:      'in_progress',
    offset_was:  offset,
    offset_now:  newOffset,
    processed,
    new_claims:  newClaims,
    nft_updates: nftUpdates,
    elapsed_ms:  Date.now() - startMs,
  });
}
