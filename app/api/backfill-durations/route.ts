import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const RPC_URL      = process.env.SUI_RPC_URL || 'https://fullnode.mainnet.sui.io:443';
const BATCH_SIZE   = 50;   // sui_multiGetTransactionBlocks max
const CONCURRENCY  = 3;    // parallel RPC batches at once
const TIME_BUDGET  = 45_000;

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

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function rpcCall<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`RPC HTTP ${res.status}`);
  const json = await res.json() as { result?: T; error?: { message: string } };
  if (json.error) throw new Error(`RPC error: ${json.error.message}`);
  return json.result as T;
}

function extractDuration(tx: any): number {
  const inputs = tx?.transaction?.data?.transaction?.inputs as Array<{
    type: string;
    valueType?: string;
    value?: string;
  }> | undefined;
  if (!inputs) return 0;
  const pureInput = inputs.find(i => i.type === 'pure' && i.valueType === 'u64');
  const raw = parseInt(pureInput?.value ?? '0');
  if (raw === 1)  return 1;
  if (raw === 7)  return 7;
  if (raw === 30) return 30;
  return 0; // season
}

async function fetchDurationsForBatch(
  txDigests: string[]
): Promise<Record<string, number>> {
  const results = await rpcCall<Array<any | null>>(
    'sui_multiGetTransactionBlocks',
    [txDigests, { showInput: true, showEffects: false, showEvents: false }]
  );
  const map: Record<string, number> = {};
  for (let i = 0; i < txDigests.length; i++) {
    map[txDigests[i]] = extractDuration(results[i]);
  }
  return map;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const db      = getDB();
  const startMs = Date.now();

  // Fetch all IKA locks that still have lock_duration = 0
  const { data: locks, error } = await db
    .from('locks')
    .select('tx_digest')
    .eq('asset_type', 'ika')
    .eq('lock_duration', 0)
    .order('tx_digest') // stable ordering for resumability
    .limit(10000);
  
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!locks || locks.length === 0) {
    return NextResponse.json({ success: true, message: 'All lock durations already backfilled', updated: 0 });
  }

  const allDigests = locks.map(l => l.tx_digest);
  const batches    = chunk(allDigests, BATCH_SIZE);

  console.log(`[Backfill] ${allDigests.length} locks to process in ${batches.length} batches`);

  let totalUpdated = 0;
  let batchIndex   = 0;

  // Process batches with CONCURRENCY parallel RPC calls
  const concurrentBatches = chunk(batches, CONCURRENCY);

  for (const parallelGroup of concurrentBatches) {
    if (Date.now() - startMs > TIME_BUDGET) {
      console.log(`[Backfill] Time budget reached - ${totalUpdated} updated, ${allDigests.length - totalUpdated - (batchIndex * BATCH_SIZE)} remaining`);
      return NextResponse.json({
        success: true,
        has_more: true,
        updated: totalUpdated,
        remaining: allDigests.length - totalUpdated,
        elapsed_ms: Date.now() - startMs,
        message: 'Trigger again to continue',
      });
    }

    // Fetch durations for this parallel group simultaneously
    const groupResults = await Promise.all(
      parallelGroup.map(batch => fetchDurationsForBatch(batch))
    );

    // Merge all results from this parallel group
    const merged: Record<string, number> = {};
    for (const result of groupResults) {
      Object.assign(merged, result);
    }

    // Group by duration value to minimize DB calls
    const byDuration: Record<number, string[]> = {};
    for (const [digest, duration] of Object.entries(merged)) {
      if (!byDuration[duration]) byDuration[duration] = [];
      byDuration[duration].push(digest);
    }

    // Batch update by duration value
    for (const [duration, digests] of Object.entries(byDuration)) {
      for (const digestChunk of chunk(digests, 100)) {
        const { error: updateError } = await db
          .from('locks')
          .update({ lock_duration: Number(duration) })
          .in('tx_digest', digestChunk);
        if (updateError) {
          console.error(`[Backfill] Update error for duration ${duration}:`, updateError.message);
        } else {
          totalUpdated += digestChunk.length;
        }
      }
    }

    batchIndex += parallelGroup.length;
    console.log(`[Backfill] Progress: ${totalUpdated}/${allDigests.length} (${Math.round(totalUpdated/allDigests.length*100)}%)`);
  }

  return NextResponse.json({
    success: true,
    has_more: false,
    updated: totalUpdated,
    total:   allDigests.length,
    elapsed_ms: Date.now() - startMs,
    message: 'Backfill complete',
  });
}
