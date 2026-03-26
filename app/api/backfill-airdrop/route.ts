/**
 * app/api/backfill-airdrop/route.ts
 *
 * One-time backfill for airdrop_allocations table.
 * Scrapes all 125 prepare_recipients transactions to get every wallet's
 * allocation amount and SBT requirement.
 *
 * Call with: GET /api/backfill-airdrop?secret=YOUR_CRON_SECRET
 * Processes 5 txs per invocation — run ~25 times until done.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { fetchPrepareRecipientsBatch } from '@/lib/sui-rpc';

const PAGES_PER_RUN   = 5;
const TIME_BUDGET_MS  = 45_000;
const AIRDROP_PKG     = '0x5a6ae39fd84a871e94c88badc7689debae22119461ba1581f674bfe50acc1271';

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
  const rpcUrl = process.env.SUI_RPC_URL || 'https://fullnode.mainnet.sui.io:443';
  const res = await fetch(rpcUrl, {
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

async function getAllPrepareRecipientDigests(): Promise<string[]> {
  const digests: string[] = [];
  let cursor: string | null = null;

  type DigestPage = {
    data: Array<{ digest: string }>;
    nextCursor: string | null;
    hasNextPage: boolean;
  };

  while (true) {
    const result = await rpcCall<DigestPage>('suix_queryTransactionBlocks', [
      {
        filter: {
          MoveFunction: {
            package:  AIRDROP_PKG,
            module:   'distribution',
            function: 'prepare_recipients',
          },
        },
        options: { showInput: false, showEffects: false, showEvents: false, showObjectChanges: false },
      },
      cursor,
      50,
      false,
    ]);

    for (const tx of result.data) digests.push(tx.digest);
    if (!result.hasNextPage || !result.nextCursor) break;
    cursor = result.nextCursor;
  }

  return digests;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const startMs = Date.now();
  const db      = getDB();

  // ── 1. Get or cache all prepare_recipients digests ────────────────────────
  const { data: cp } = await db
    .from('indexer_checkpoints')
    .select('last_tx_digest, last_event_seq')
    .eq('event_type', 'airdrop_backfill_offset')
    .single();

  const offset = cp?.last_tx_digest ? parseInt(cp.last_tx_digest, 10) : 0;

  // Fetch all digests on first run, cache count in last_event_seq
  let allDigests: string[] = [];
  if (!cp?.last_event_seq || cp.last_event_seq === '0') {
    allDigests = await getAllPrepareRecipientDigests();
    // Save total count
    await db.from('indexer_checkpoints').upsert(
      {
        event_type:     'airdrop_backfill_offset',
        last_tx_digest: String(offset),
        last_event_seq: String(allDigests.length),
        updated_at:     new Date().toISOString(),
      },
      { onConflict: 'event_type' }
    );
  } else {
    // Re-fetch all digests (they don't change)
    allDigests = await getAllPrepareRecipientDigests();
  }

  const totalDigests = allDigests.length;

  if (offset >= totalDigests) {
    await db.from('indexer_checkpoints').delete().eq('event_type', 'airdrop_backfill_offset');
    return NextResponse.json({ done: true, message: 'All prepare_recipients txs processed!' });
  }

  const batch   = allDigests.slice(offset, offset + PAGES_PER_RUN);
  const log: Record<string, unknown>[] = [];
  let totalInserted = 0;

  // ── 2. Process each tx in batch ───────────────────────────────────────────
  try {
    const recipients = await fetchPrepareRecipientsBatch(batch);

    if (recipients.length > 0) {
      // Upsert in chunks of 500
      const CHUNK = 500;
      for (let i = 0; i < recipients.length; i += CHUNK) {
        const slice = recipients.slice(i, i + CHUNK);
        const { error } = await db
          .from('airdrop_allocations')
          .upsert(slice, { onConflict: 'wallet_address', ignoreDuplicates: true });
        if (error) throw new Error(error.message);
      }
      totalInserted += recipients.length;
      log.push({ txs: batch.length, recipients: recipients.length, status: 'ok' });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.push({ status: 'error', error: msg, txs: batch });
  }

  // ── 3. Save new offset ────────────────────────────────────────────────────
  const newOffset = offset + batch.length;
  const allDone   = newOffset >= totalDigests;

  if (allDone) {
    await db.from('indexer_checkpoints').delete().eq('event_type', 'airdrop_backfill_offset');
  } else {
    await db.from('indexer_checkpoints').upsert(
      {
        event_type:     'airdrop_backfill_offset',
        last_tx_digest: String(newOffset),
        last_event_seq: String(totalDigests),
        updated_at:     new Date().toISOString(),
      },
      { onConflict: 'event_type' }
    );
  }

  return NextResponse.json({
    done:               allDone,
    offset_was:         offset,
    offset_now:         allDone ? totalDigests : newOffset,
    total_txs:          totalDigests,
    txs_remaining:      allDone ? 0 : totalDigests - newOffset,
    recipients_inserted: totalInserted,
    elapsed_ms:         Date.now() - startMs,
    log,
  });
}
