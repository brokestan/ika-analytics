/**
 * app/api/backfill-riddles/route.ts
 *
 * One-time backfill for gap wallets — fetches missing riddle submissions
 * using FromAddress filter per wallet, filters for v4 submit_riddle_answer calls,
 * inserts only the ones not already in riddle_submissions.
 *
 * Call with: GET /api/backfill-riddles?secret=YOUR_CRON_SECRET
 * Processes WALLETS_PER_RUN wallets per call — run multiple times until done.
 * Progress is saved in indexer_checkpoints as 'riddle_backfill_offset'.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const V4_PKG        = '0x765307507478ca630ddc0c44ab3bb9e83c3aa98aea2777a4f0aea0ade4a853f8';
const RPC_URL       = process.env.SUI_RPC_URL || 'https://fullnode.mainnet.sui.io:443';
const WALLETS_PER_RUN = 5;   // process 10 wallets per Vercel invocation
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

// Fetch ALL riddle submissions for a specific wallet using FromAddress filter
async function fetchWalletRiddleSubmissions(walletAddress: string): Promise<Array<{
  txDigest:     string;
  riddleNumber: number;
  submittedAt:  string | null;
}>> {
  const results: Array<{ txDigest: string; riddleNumber: number; submittedAt: string | null }> = [];
  let cursor: string | null = null;

  type TxResult = {
    data: Array<{
      digest: string;
      timestampMs?: string;
      transaction?: {
        data?: {
          sender?: string;
          transaction?: {
            kind?: string;
            transactions?: Array<{
              MoveCall?: {
                package?: string;
                module?:  string;
                function?: string;
              };
            }>;
            inputs?: Array<{
              type?:      string;
              valueType?: string;
              value?:     string;
            }>;
          };
        };
      };
    }>;
    nextCursor: string | null;
    hasNextPage: boolean;
  };

  while (true) {
    const page: TxResult = await rpcCall<TxResult>('suix_queryTransactionBlocks', [
      {
        filter:  { FromAddress: walletAddress },
        options: { showInput: true },
      },
      cursor,
      50,
      false, // ascending
    ]);

    for (const tx of page.data) {
      const txns = tx.transaction?.data?.transaction?.transactions ?? [];
      const inputs = tx.transaction?.data?.transaction?.inputs ?? [];

      // Check if any MoveCall in this tx is our submit_riddle_answer
      // Check all possible structures — direct MoveCall, PTB nested, sponsored
      const rawTx = tx.transaction?.data?.transaction as {
        kind?: string;
        transactions?: Array<{
          MoveCall?: { package?: string; module?: string; function?: string };
        }>;
        moveCall?: { package?: string; module?: string; function?: string };
      } | undefined;

      const txnsList = rawTx?.transactions ?? [];
      const isRiddleSubmission =
        // PTB structure — MoveCall inside transactions array
        txnsList.some((t) =>
          t.MoveCall?.package === V4_PKG &&
          t.MoveCall?.module  === 'tasks' &&
          t.MoveCall?.function === 'submit_riddle_answer'
        ) ||
        // Direct MoveCall structure
        (rawTx?.moveCall?.package === V4_PKG &&
         rawTx?.moveCall?.module  === 'tasks' &&
         rawTx?.moveCall?.function === 'submit_riddle_answer');

      if (!isRiddleSubmission) continue;

      // Find riddle number — inputs[1] in PTB, inputs[0] in direct call
      const riddleInput  = inputs[1] ?? inputs[0];
      const riddleNumber = riddleInput?.value !== undefined
        ? parseInt(String(riddleInput.value), 10)
        : NaN;

      if (isNaN(riddleNumber) || riddleNumber < 1 || riddleNumber > 3) continue;

      results.push({
        txDigest:     tx.digest,
        riddleNumber,
        submittedAt:  tx.timestampMs
          ? new Date(parseInt(tx.timestampMs)).toISOString()
          : null,
      });
    }

    if (!page.hasNextPage || !page.nextCursor) break;
    cursor = page.nextCursor;
    await sleep(300); // be kind to the RPC
  }

  return results;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const startMs = Date.now();
  const db      = getDB();

  // ── 1. Get gap wallets ─────────────────────────────────────────────────────
  const { data: gapRows, error: gapErr } = await db.rpc('get_riddle_gap_wallets');
  if (gapErr) {
    return NextResponse.json({ error: gapErr.message }, { status: 500 });
  }
  const gapWallets = (gapRows as Array<{ wallet_address: string; missing_submissions: number }>) || [];

  if (gapWallets.length === 0) {
    return NextResponse.json({ done: true, message: 'No gap wallets found — all caught up!' });
  }

  // ── 2. Get current offset ─────────────────────────────────────────────────
  const { data: cp } = await db
    .from('indexer_checkpoints')
    .select('last_tx_digest')
    .eq('event_type', 'riddle_backfill_offset')
    .single();

  const offset = cp?.last_tx_digest ? parseInt(cp.last_tx_digest, 10) : 0;
  const batch  = gapWallets.slice(offset, offset + WALLETS_PER_RUN);

  if (batch.length === 0) {
    // Reset offset — all done
    await db.from('indexer_checkpoints').delete().eq('event_type', 'riddle_backfill_offset');
    return NextResponse.json({ done: true, message: 'All gap wallets processed!' });
  }

  // ── 3. Process each wallet ────────────────────────────────────────────────
  const log: Record<string, unknown>[] = [];
  let totalInserted = 0;

  for (const { wallet_address } of batch) {
    if (Date.now() - startMs > TIME_BUDGET_MS) {
      log.push({ wallet: wallet_address, status: 'time_budget_reached' });
      break;
    }

    try {
      // Fetch all riddle submissions for this wallet on-chain
      const onChain = await fetchWalletRiddleSubmissions(wallet_address);

      if (onChain.length === 0) {
        log.push({ wallet: wallet_address, status: 'no_riddle_txs_found' });
        continue;
      }

      // Get already-indexed tx digests for this wallet
      const { data: existing } = await db
        .from('riddle_submissions')
        .select('tx_digest')
        .eq('wallet_address', wallet_address);

      const existingSet = new Set((existing || []).map((r: { tx_digest: string }) => r.tx_digest));

      // Filter to only missing ones
      const missing = onChain.filter(s => !existingSet.has(s.txDigest));

      if (missing.length === 0) {
        log.push({ wallet: wallet_address, status: 'already_complete', on_chain: onChain.length });
        continue;
      }

      // Insert missing riddle_submissions
      const submissionRows = missing.map(s => ({
        wallet_address: wallet_address,
        riddle_number:  s.riddleNumber,
        tx_digest:      s.txDigest,
        submitted_at:   s.submittedAt,
        solved:         false,
      }));

      const { error: subErr } = await db
        .from('riddle_submissions')
        .upsert(submissionRows, { onConflict: 'tx_digest' });

      if (subErr) {
        log.push({ wallet: wallet_address, status: 'error', error: subErr.message });
        continue;
      }

      // Insert corresponding drizzlet rows
      const drizzletRows = missing.map(s => ({
        wallet_address: wallet_address,
        source:         'riddle',
        amount:         31,
        reference_id:   s.txDigest,
        earned_at:      s.submittedAt,
      }));

      const { error: drzErr } = await db
        .from('drizzlets')
        .upsert(drizzletRows, { onConflict: 'wallet_address,reference_id' });

      if (drzErr) {
        log.push({ wallet: wallet_address, status: 'drizzlet_error', error: drzErr.message });
        continue;
      }

      totalInserted += missing.length;
      log.push({
        wallet:   wallet_address,
        status:   'fixed',
        inserted: missing.length,
        on_chain: onChain.length,
        was_indexed: onChain.length - missing.length,
      });

      await sleep(500); // pause between wallets

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.push({ wallet: wallet_address, status: 'error', error: msg });
    }
  }

  // ── 4. Save new offset ────────────────────────────────────────────────────
  const newOffset = offset + batch.length;
  const allDone   = newOffset >= gapWallets.length;

  if (allDone) {
    await db.from('indexer_checkpoints').delete().eq('event_type', 'riddle_backfill_offset');
  } else {
    await db.from('indexer_checkpoints').upsert(
      {
        event_type:     'riddle_backfill_offset',
        last_tx_digest: String(newOffset),
        last_event_seq: '0',
        updated_at:     new Date().toISOString(),
      },
      { onConflict: 'event_type' }
    );
  }

  return NextResponse.json({
    done:            allDone,
    offset_was:      offset,
    offset_now:      allDone ? 0 : newOffset,
    wallets_total:   gapWallets.length,
    wallets_remaining: allDone ? 0 : gapWallets.length - newOffset,
    submissions_inserted: totalInserted,
    elapsed_ms:      Date.now() - startMs,
    log,
  });
}
