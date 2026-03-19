import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  getCheckpoint,
  saveCheckpoint,
  clearCheckpoint,
  writeRefreshLog,
} from '@/lib/serverSupabase';
import {
  fetchLockStakeEvents,
  fetchUnlockEvents,
  fetchISUILockEvents,
  fetchISUIUnlockEvents,
  fetchRiddlePool,
  fetchRiddleSubmissions,
  fetchV3RiddleSubmissions,
  fetchDurationsForBatch,
  toHumanIka,
  toHumanISUI,
  getDrizzletRate,
  calcIkaDrizzlets,
  calcISUIDrizzlets,
  RIDDLE_DRIZZLETS_PER_SUBMISSION,
  fetchMfSquidMaidenMintEvents,
  fetchTransactionEventsInBatch,
  fetchIkaChanNftObjects,
  calcNftDrizzlets,
  fetchUserTasksObjectIds,
  fetchUserTasksObjects,
} from '@/lib/sui-rpc';
import { buildLockDistribution, forecastDrizzlets } from '@/lib/calculations';
import { LockDuration } from '@/lib/types';

const BATCH_SIZE      = 50;
const RATE_LIMIT_WAIT = 1500;
const MAX_RETRIES     = 3;
const TIME_BUDGET_MS  = 50_000;
const MAX_RUN_AGE_MS  = 2 * 60 * 1000;

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
  const cron = req.headers.get('x-vercel-cron') === '1';
  return auth === `Bearer ${secret}` || qs === secret || cron;
}

function sleep(ms: number) {
  return new Promise<void>(r => setTimeout(r, ms));
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try { return await fn(); }
    catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[${label}] attempt ${attempt}: ${msg}`);
      if ((msg.includes('429') || msg.includes('Too Many')) && attempt < MAX_RETRIES) {
        await sleep(RATE_LIMIT_WAIT * attempt);
        continue;
      }
      if (attempt === MAX_RETRIES) {
        throw new Error(`[${label}] failed after ${MAX_RETRIES} attempts: ${msg}`);
      }
    }
  }
  throw new Error(`[${label}] unreachable`);
}

function dedupEvents(events: any[]): any[] {
  const seen = new Set<string>();
  return events.filter(e => {
    const key = `${e.txDigest}:${e.eventSeq ?? '0'}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function dedupByAddress(events: any[]): any[] {
  const seen = new Set<string>();
  return events.filter(e => {
    if (seen.has(e.account)) return false;
    seen.add(e.account);
    return true;
  });
}

function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'object' && err !== null && 'message' in err) return String((err as any).message);
  return String(err);
}

async function resetRunningState(db: ReturnType<typeof getDB>) {
  console.log('[Indexer] Resetting is_running...');
  await db.from('indexer_state').update({
    is_running:  false,
    last_run_at: new Date().toISOString(),
    updated_at:  new Date().toISOString(),
  }).eq('id', 'lock_events');
  console.log('[Indexer] is_running reset complete');
}

// ---- RPC connectivity test --------------------------------------------------

async function testRpcConnectivity(): Promise<{ ok: boolean; error?: string }> {
  try {
    const rpcUrl = process.env.SUI_RPC_URL || 'https://fullnode.mainnet.sui.io:443';
    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1,
        method: 'sui_getLatestCheckpointSequenceNumber',
        params: [],
      }),
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status} from RPC` };
    const json = await res.json() as { result?: unknown; error?: { message: string } };
    if (json.error) return { ok: false, error: `RPC error: ${json.error.message}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `RPC unreachable: ${errMsg(err)}` };
  }
}

// ---- Main handler -----------------------------------------------------------

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const mode    = req.nextUrl.searchParams.get('mode') === 'full' ? 'full' : 'checkpoint';
  const db      = getDB();
  const now     = new Date().toISOString();
  const startMs = Date.now();
  const log: Record<string, unknown> = { mode, started_at: now };

  const rpcCheck = await testRpcConnectivity();
  if (!rpcCheck.ok) {
    return NextResponse.json({
      success: false,
      error: rpcCheck.error,
      hint: 'RPC is unreachable from Vercel. Check SUI_RPC_URL env var.',
    }, { status: 502 });
  }
  log.rpc_ok = true;

  // Auto-reset stale is_running after 2 minutes
  const { data: st } = await db
    .from('indexer_state').select('is_running, last_run_at').eq('id', 'lock_events').single();

  if (st?.is_running) {
    const lastRunAt = st.last_run_at ? new Date(st.last_run_at).getTime() : 0;
    const ageMs     = Date.now() - lastRunAt;
    if (ageMs > MAX_RUN_AGE_MS) {
      console.warn('[Indexer] Stale is_running detected - auto-resetting');
      await db.from('indexer_state')
        .update({ is_running: false, updated_at: now })
        .eq('id', 'lock_events');
    } else {
      return NextResponse.json({ message: 'Already running' }, { status: 409 });
    }
  }

  await db.from('indexer_state')
    .update({ is_running: true, updated_at: now }).eq('id', 'lock_events');

  try {
    if (mode === 'full') {
      await Promise.all([
        clearCheckpoint(db, 'lock_events'),
        clearCheckpoint(db, 'unlock_events'),
        clearCheckpoint(db, 'isui_lock_events'),
        clearCheckpoint(db, 'isui_unlock_events'),
        clearCheckpoint(db, 'mfsm_events'),
        clearCheckpoint(db, 'riddle_submission_txs'),
      ]);
      console.log('[Indexer] Checkpoints cleared - full mode');
    }

    // -- 1. iSUI Locks --------------------------------------------------------
    const isuiLockResult = await processStream(
      db, now, startMs, 'isui_lock_events',
      (cursor) => fetchISUILockEvents(cursor),
      async (page, db, now) => {
        const uniqueEvents  = dedupEvents(page.data as any[]);
        const uniqueWallets = dedupByAddress(uniqueEvents);

        const wallets = uniqueWallets.map((e: any) => ({
          address:        e.account,
          last_active_at: e.timestampMs
            ? new Date(parseInt(e.timestampMs)).toISOString()
            : now,
        }));
        for (const b of chunk(wallets, BATCH_SIZE)) {
          await withRetry(async () =>
            db.from('wallets').upsert(b, { onConflict: 'address' })
              .then(r => { if (r.error) throw new Error(r.error.message); return r; }),
            'isui-lock-wallets'
          );
        }

        const rows = uniqueEvents.map((e: any) => ({
          wallet_address: e.account,
          tx_digest:      e.txDigest,
          asset_type:     'isui',
          lock_duration:  0,
          ika_amount:     0,
          isui_amount:    toHumanISUI(e.isui_balance),
          locked_at:      e.state_time_ts
            ? new Date(parseInt(e.state_time_ts)).toISOString()
            : new Date(parseInt(e.timestampMs || '0')).toISOString(),
          state_time_ts:  e.state_time_ts,
          is_active:      true,
        }));
        for (const b of chunk(rows, BATCH_SIZE)) {
          await withRetry(async () =>
            db.from('locks').upsert(b, { onConflict: 'tx_digest' })
              .then(r => { if (r.error) throw new Error(r.error.message); return r; }),
            'isui-lock-upsert'
          );
        }
        return rows.length;
      }
    );
    log.isui_locks = isuiLockResult;

    // -- 2. iSUI Unlocks ------------------------------------------------------
    const isuiUnlockResult = await processStream(
      db, now, startMs, 'isui_unlock_events',
      (cursor) => fetchISUIUnlockEvents(cursor),
      async (page, db, now) => {
        const events = dedupEvents(page.data as any[]);

        for (const e of events) {
          await withRetry(async () =>
            db.from('locks')
              .update({
                is_active:        false,
                unlocked_at:      new Date(parseInt(e.unlock_time_ts)).toISOString(),
                drizzlets_earned: Number(e.drizzlets_earned),
                updated_at:       now,
              })
              .eq('wallet_address', e.account)
              .eq('state_time_ts',  e.state_time_ts)
              .eq('asset_type',     'isui')
              .eq('is_active',      true)
              .then(r => { if (r.error) throw new Error(r.error.message); return r; }),
            'isui-unlock-update'
          );
        }

        const drizzletRows = events.map((e: any) => ({
          wallet_address: e.account,
          source:         'isui_lock',
          amount:         Number(e.drizzlets_earned),
          reference_id:   e.txDigest,
          earned_at:      new Date(parseInt(e.unlock_time_ts)).toISOString(),
        }));
        for (const b of chunk(drizzletRows, BATCH_SIZE)) {
          await withRetry(async () =>
            db.from('drizzlets').upsert(b, { onConflict: 'wallet_address,reference_id' })
              .then(r => { if (r.error) throw new Error(r.error.message); return r; }),
            'isui-unlock-drizzlets'
          );
        }

        return events.length;
      }
    );
    log.isui_unlocks = isuiUnlockResult;

    // -- 3. IKA Locks (already complete - skips instantly) --------------------
    const ikaLockResult = await processStream(
      db, now, startMs, 'lock_events',
      (cursor) => fetchLockStakeEvents(cursor),
      async (page, db, now) => {
        const uniqueEvents  = dedupEvents(page.data as any[]);
        const uniqueWallets = dedupByAddress(uniqueEvents);

        const wallets = uniqueWallets.map((e: any) => ({
          address:        e.account,
          last_active_at: e.timestampMs
            ? new Date(parseInt(e.timestampMs)).toISOString()
            : now,
        }));
        for (const b of chunk(wallets, BATCH_SIZE)) {
          await withRetry(async () =>
            db.from('wallets').upsert(b, { onConflict: 'address' })
              .then(r => { if (r.error) throw new Error(r.error.message); return r; }),
            'ika-lock-wallets'
          );
        }

        const digests = uniqueEvents.map((e: any) => e.txDigest);
        const durations = await fetchDurationsForBatch(digests);

        const rows = uniqueEvents.map((e: any) => ({
          wallet_address: e.account,
          tx_digest:      e.txDigest,
          asset_type:     'ika',
          lock_duration:  durations[e.txDigest] ?? 0,
          ika_amount:     toHumanIka(e.staked_ika_balance),
          isui_amount:    0,
          locked_at:      e.state_time_ts
            ? new Date(parseInt(e.state_time_ts)).toISOString()
            : new Date(parseInt(e.timestampMs || '0')).toISOString(),
          state_time_ts:  e.state_time_ts,
          is_active:      true,
        }));
        for (const b of chunk(rows, BATCH_SIZE)) {
          await withRetry(async () =>
            db.from('locks').upsert(b, { onConflict: 'tx_digest' })
              .then(r => { if (r.error) throw new Error(r.error.message); return r; }),
            'ika-lock-upsert'
          );
        }
        return rows.length;
      }
    );
    log.ika_locks = ikaLockResult;

    // -- 4. IKA Unlocks (resumes from saved checkpoint) -----------------------
    const ikaUnlockResult = await processStream(
      db, now, startMs, 'unlock_events',
      (cursor) => fetchUnlockEvents(cursor),
      async (page, db, now) => {
        const events = dedupEvents(page.data as any[]);

        for (const e of events) {
          await withRetry(async () =>
            db.from('locks')
              .update({
                is_active:        false,
                unlocked_at:      new Date(parseInt(e.unlock_time_ts)).toISOString(),
                drizzlets_earned: Number(e.drizzlets_earned),
                updated_at:       now,
              })
              .eq('wallet_address', e.account)
              .eq('state_time_ts',  e.state_time_ts)
              .eq('asset_type',     'ika')
              .eq('is_active',      true)
              .then(r => { if (r.error) throw new Error(r.error.message); return r; }),
            'ika-unlock-update'
          );
        }

        const drizzletRows = events.map((e: any) => ({
          wallet_address: e.account,
          source:         'unlock',
          amount:         Number(e.drizzlets_earned),
          reference_id:   e.txDigest,
          earned_at:      new Date(parseInt(e.unlock_time_ts)).toISOString(),
        }));
        for (const b of chunk(drizzletRows, BATCH_SIZE)) {
          await withRetry(async () =>
            db.from('drizzlets').upsert(b, { onConflict: 'wallet_address,reference_id' })
              .then(r => { if (r.error) throw new Error(r.error.message); return r; }),
            'ika-unlock-drizzlets'
          );
        }

        return events.length;
      }
    );
    log.ika_unlocks = ikaUnlockResult;

    // -- 5. MF Squid Maiden Mints + NFT Reveals ------------------------------
    const mfsmResult = await processStream(
      db, now, startMs, 'mfsm_events',
      (cursor) => fetchMfSquidMaidenMintEvents(cursor),
      async (page, db, now) => {
        const events = dedupEvents(page.data as any[]);
        if (events.length === 0) return 0;

        // Step 1: fetch ika_chan_nft_id from each tx via NFTUpdated event
        const txDigests = events.map((e: any) => e.txDigest);
        const ikaChanMap = await fetchTransactionEventsInBatch(txDigests);

        // Step 2: fetch NFT objects for level+rarity
        const ikaChanIds = [...new Set(Object.values(ikaChanMap))];
        const nftDataMap = await fetchIkaChanNftObjects(ikaChanIds);

        // Step 3: save mf_squid_maiden_mints with ika_chan_nft_id
        const mintRows = events.map((e: any) => ({
          tx_digest:       e.txDigest,
          wallet_address:  e.wallet,
          nft_id:          e.nft_id,
          ika_chan_nft_id: ikaChanMap[e.txDigest] ?? null,
          minted_at:       e.timestampMs
            ? new Date(Number(e.timestampMs)).toISOString()
            : now,
        }));
        for (const b of chunk(mintRows, BATCH_SIZE)) {
          await withRetry(async () =>
            db.from('mf_squid_maiden_mints')
              .upsert(b, { onConflict: 'tx_digest', ignoreDuplicates: true })
              .then(r => { if (r.error) throw new Error(r.error.message); return r; }),
            'mfsm-upsert'
          );
        }

        // Step 4: build and save nft_reveals rows for events with NFT data
        const revealRows: any[] = [];
        for (const e of events) {
          const ikaChanNftId = ikaChanMap[e.txDigest];
          if (!ikaChanNftId) continue;
          const nftData = nftDataMap[ikaChanNftId];
          if (!nftData) continue;
          revealRows.push({
            wallet_address:     e.wallet,
            tx_digest:          e.txDigest,
            nft_id:             ikaChanNftId,
            mf_squid_maiden_id: e.nft_id,
            level:              nftData.level,
            rarity:             nftData.rarity,
            drizzlets_earned:   calcNftDrizzlets(nftData.rarity, nftData.level),
            revealed_at:        e.timestampMs
              ? new Date(Number(e.timestampMs)).toISOString()
              : now,
          });
        }

        if (revealRows.length > 0) {
          for (const b of chunk(revealRows, BATCH_SIZE)) {
            await withRetry(async () =>
              db.from('nft_reveals').upsert(b, { onConflict: 'tx_digest,nft_id', ignoreDuplicates: true })
                .then(r => { if (r.error) throw new Error(r.error.message); return r; }),
              'nft-reveals-upsert'
            );
          }
          const drzRows = revealRows.map((r: any) => ({
            wallet_address: r.wallet_address,
            source:         'nft_reveal',
            amount:         r.drizzlets_earned,
            reference_id:   r.tx_digest,
            earned_at:      r.revealed_at,
          }));
          for (const b of chunk(drzRows, BATCH_SIZE)) {
            await withRetry(async () =>
              db.from('drizzlets').upsert(b, { onConflict: 'wallet_address,reference_id', ignoreDuplicates: true })
                .then(r => { if (r.error) throw new Error(r.error.message); return r; }),
              'nft-reveal-drizzlets'
            );
          }
        }

        return events.length;
      }
    );
    log.mfsm_mints = mfsmResult;
    // -- 6. Riddle Pool -------------------------------------------------------
    try {
      const pool = await fetchRiddlePool();
      if (pool) {
        await Promise.all([
          db.from('riddle_pools').upsert(
            { pool_index: 1, amount: pool.pool1, raw_amount: String(pool.pool1), fetched_at: now },
            { onConflict: 'pool_index' }
          ),
          db.from('riddle_pools').upsert(
            { pool_index: 2, amount: pool.pool2, raw_amount: String(pool.pool2), fetched_at: now },
            { onConflict: 'pool_index' }
          ),
          db.from('riddle_pools').upsert(
            { pool_index: 3, amount: pool.pool3, raw_amount: String(pool.pool3), fetched_at: now },
            { onConflict: 'pool_index' }
          ),
        ]);
        log.riddle_pools = pool;
      }
      log.riddle_fetched = !!pool;
    } catch (err) {
      console.error('[riddle-pool]', errMsg(err));
      log.riddle_fetched = false;
    }

    // -- 7. Riddle Submissions -------------------------------------------------
    const riddleSubResult = await processStream(
      db, now, startMs, 'riddle_submission_txs',
      (cursor) => fetchRiddleSubmissions(cursor),
      async (page, db, now) => {
        const subs = dedupEvents(page.data as any[]);

        // ── Save skipped transactions for inspection ────────────────────
        const skipped = (page as any).skipped as Array<{
          txDigest:  string;
          rawInputs: unknown;
          rawTxns:   unknown;
        }> | undefined;

        if (skipped && skipped.length > 0) {
          const skipRows = skipped.map(s => ({
            tx_digest:  s.txDigest,
            raw_inputs: s.rawInputs,
            raw_txns:   s.rawTxns,
          }));
          await db
            .from('riddle_submission_skips')
            .upsert(skipRows, { onConflict: 'tx_digest', ignoreDuplicates: true });
        }

        const seenWallets = new Set<string>();
        const wallets = subs
          .filter((s: any) => {
            if (seenWallets.has(s.wallet_address)) return false;
            seenWallets.add(s.wallet_address);
            return true;
          })
          .map((s: any) => ({
            address:        s.wallet_address,
            last_active_at: s.timestampMs
              ? new Date(parseInt(s.timestampMs)).toISOString()
              : now,
          }));
        for (const b of chunk(wallets, BATCH_SIZE)) {
          await withRetry(async () =>
            db.from('wallets').upsert(b, { onConflict: 'address' })
              .then(r => { if (r.error) throw new Error(r.error.message); return r; }),
            'riddle-sub-wallets'
          );
        }

        const utSeedRows = wallets.map((w: any) => ({ wallet_address: w.address }));
        for (const b of chunk(utSeedRows, BATCH_SIZE)) {
          await withRetry(async () =>
            db.from('wallet_user_tasks').upsert(b, { onConflict: 'wallet_address', ignoreDuplicates: true })
              .then(r => { if (r.error) throw new Error(r.error.message); return r; }),
            'riddle-sub-ut-seed'
          );
        }

        const rows = subs
          .filter((s: any) => s.riddle_number >= 1 && s.riddle_number <= 3)
          .map((s: any) => ({
            wallet_address: s.wallet_address,
            riddle_number:  s.riddle_number,
            tx_digest:      s.txDigest,
            submitted_at:   new Date(parseInt(s.timestampMs)).toISOString(),
            solved:         false,
          }));
        for (const b of chunk(rows, BATCH_SIZE)) {
          await withRetry(async () =>
            db.from('riddle_submissions').upsert(b, { onConflict: 'tx_digest' })
              .then(r => { if (r.error) throw new Error(r.error.message); return r; }),
            'riddle-sub-upsert'
          );
        }

        const drizzletRows = subs
          .filter((s: any) => s.riddle_number >= 1 && s.riddle_number <= 3)
          .map((s: any) => ({
            wallet_address: s.wallet_address,
            source:         'riddle',
            amount:         RIDDLE_DRIZZLETS_PER_SUBMISSION,
            reference_id:   s.txDigest,
            earned_at:      new Date(parseInt(s.timestampMs)).toISOString(),
          }));
        for (const b of chunk(drizzletRows, BATCH_SIZE)) {
          await withRetry(async () =>
            db.from('drizzlets').upsert(b, { onConflict: 'wallet_address,reference_id' })
              .then(r => { if (r.error) throw new Error(r.error.message); return r; }),
            'riddle-sub-drizzlets'
          );
        }

        return rows.length;
      }
    );
    log.riddle_submissions = riddleSubResult;

    // -- 7b. V3 Riddle Submissions (one-time historical) -------------------
    const v3RiddleSubResult = await processStream(
      db, now, startMs, 'v3_riddle_submission_txs',
      (cursor) => fetchV3RiddleSubmissions(cursor),
      async (page, db, now) => {
        const subs = dedupEvents(page.data as any[]);

        // Save skipped for inspection
        const skipped = (page as any).skipped as Array<{
          txDigest:  string;
          rawInputs: unknown;
          rawTxns:   unknown;
        }> | undefined;

        if (skipped && skipped.length > 0) {
          const skipRows = skipped.map(s => ({
            tx_digest:  s.txDigest,
            raw_inputs: s.rawInputs,
            raw_txns:   s.rawTxns,
          }));
          await db
            .from('riddle_submission_skips')
            .upsert(skipRows, { onConflict: 'tx_digest', ignoreDuplicates: true });
        }

        const seenWallets = new Set<string>();
        const wallets = subs
          .filter((s: any) => {
            if (seenWallets.has(s.wallet_address)) return false;
            seenWallets.add(s.wallet_address);
            return true;
          })
          .map((s: any) => ({
            address:        s.wallet_address,
            last_active_at: s.timestampMs
              ? new Date(parseInt(s.timestampMs)).toISOString()
              : now,
          }));
        for (const b of chunk(wallets, BATCH_SIZE)) {
          await withRetry(async () =>
            db.from('wallets').upsert(b, { onConflict: 'address' })
              .then(r => { if (r.error) throw new Error(r.error.message); return r; }),
            'v3-riddle-sub-wallets'
          );
        }

        const utSeedRows = wallets.map((w: any) => ({ wallet_address: w.address }));
        for (const b of chunk(utSeedRows, BATCH_SIZE)) {
          await withRetry(async () =>
            db.from('wallet_user_tasks').upsert(b, { onConflict: 'wallet_address', ignoreDuplicates: true })
              .then(r => { if (r.error) throw new Error(r.error.message); return r; }),
            'v3-riddle-sub-ut-seed'
          );
        }

        const rows = subs
          .filter((s: any) => s.riddle_number >= 1 && s.riddle_number <= 3)
          .map((s: any) => ({
            wallet_address: s.wallet_address,
            riddle_number:  s.riddle_number,
            tx_digest:      s.txDigest,
            submitted_at:   new Date(parseInt(s.timestampMs)).toISOString(),
            solved:         false,
          }));
        for (const b of chunk(rows, BATCH_SIZE)) {
          await withRetry(async () =>
            db.from('riddle_submissions').upsert(b, { onConflict: 'tx_digest' })
              .then(r => { if (r.error) throw new Error(r.error.message); return r; }),
            'v3-riddle-sub-upsert'
          );
        }

        const drizzletRows = subs
          .filter((s: any) => s.riddle_number >= 1 && s.riddle_number <= 3)
          .map((s: any) => ({
            wallet_address: s.wallet_address,
            source:         'riddle',
            amount:         RIDDLE_DRIZZLETS_PER_SUBMISSION,
            reference_id:   s.txDigest,
            earned_at:      new Date(parseInt(s.timestampMs)).toISOString(),
          }));
        for (const b of chunk(drizzletRows, BATCH_SIZE)) {
          await withRetry(async () =>
            db.from('drizzlets').upsert(b, { onConflict: 'wallet_address,reference_id' })
              .then(r => { if (r.error) throw new Error(r.error.message); return r; }),
            'v3-riddle-sub-drizzlets'
          );
        }

        return rows.length;
      }
    );
    log.v3_riddle_submissions = v3RiddleSubResult;

    // -- 8. UserTasks Sync------------------------------------------------------
    try {
      // Get up to 150 wallets that haven't been fetched yet
      const { data: pending } = await db
        .from('wallet_user_tasks')
        .select('wallet_address')
        .is('last_fetched_at', null)
        .limit(150);

      if (pending && pending.length > 0) {
        const walletBatch = pending.map((r: any) => r.wallet_address);

        // Get one tx_digest per wallet from riddle_submissions
        const txMap: Record<string, string> = {};
        for (const b of chunk(walletBatch, BATCH_SIZE)) {
          const { data: txRows } = await db
            .from('riddle_submissions')
            .select('wallet_address, tx_digest')
            .in('wallet_address', b);
          for (const row of txRows || []) {
            if (!txMap[row.wallet_address]) txMap[row.wallet_address] = row.tx_digest;
          }
        }

        const wallets = Object.keys(txMap);

        // Discover UserTasks object IDs from tx objectChanges
        const objectIdMap: Record<string, string> = {}; // wallet -> objectId
        for (const b of chunk(wallets, 50)) {
          const bDigests = b.map((w: string) => txMap[w]);
          const discovered = await withRetry(
            () => fetchUserTasksObjectIds(bDigests),
            'ut-discover'
          );
          for (const wallet of b) {
            const objId = discovered[txMap[wallet]];
            if (objId) objectIdMap[wallet] = objId;
          }
          await sleep(300);
        }

        // Fetch UserTasks object data
        const objectIds = Object.values(objectIdMap);
        const userData: Record<string, import('@/lib/sui-rpc').UserTasksData> = {};
        for (const b of chunk(objectIds, 50)) {
          const fetched = await withRetry(
            () => fetchUserTasksObjects(b),
            'ut-fetch'
          );
          Object.assign(userData, fetched);
          await sleep(300);
        }

        // Upsert results into wallet_user_tasks
        const utRows = wallets.map((wallet: string) => {
          const objId = objectIdMap[wallet];
          const data  = objId ? userData[objId] : null;
          return {
            wallet_address:      wallet,
            object_id:           objId           ?? null,
            riddle_one_solved:   data?.riddleOneSolved   ?? false,
            riddle_two_solved:   data?.riddleTwoSolved   ?? false,
            riddle_three_solved: data?.riddleThreeSolved ?? false,
            chain_drizzlets:     data?.chainDrizzlets    ?? null,
            community_code:      data?.communityCode     ?? null,
            last_fetched_at:     now,
          };
        });
        for (const b of chunk(utRows, BATCH_SIZE)) {
          await withRetry(async () =>
            db.from('wallet_user_tasks').upsert(b, { onConflict: 'wallet_address' })
              .then(r => { if (r.error) throw new Error(r.error.message); return r; }),
            'ut-upsert'
          );
        }
        log.user_tasks_fetched = utRows.length;
      } else {
        log.user_tasks_fetched = 0;
      }
    } catch (err) {
      console.error('[user-tasks]', errMsg(err));
      log.user_tasks_fetched = 0;
    }
    
    const hasMore =
      (ikaLockResult    as StreamResult).hasMore ||
      (ikaUnlockResult  as StreamResult).hasMore ||
      (isuiLockResult   as StreamResult).hasMore ||
      (isuiUnlockResult as StreamResult).hasMore ||
      (mfsmResult       as StreamResult).hasMore ||
      (riddleSubResult  as StreamResult).hasMore ||
      (v3RiddleSubResult  as StreamResult).hasMore;

    log.has_more     = hasMore;
    log.elapsed_ms   = Date.now() - startMs;
    log.completed_at = new Date().toISOString();
    log.success      = true;

    // Reset FIRST - before anything else that could push past 60s
    await resetRunningState(db);
    await writeRefreshLog(db, mode, 'success', log);

    // Only rebuild aggregates when fully caught up
    if (!hasMore) {
      await rebuildAggregates(db, now);
    }

    return NextResponse.json({ success: true, has_more: hasMore, ...log });

  } catch (err) {
    const msg = errMsg(err);
    console.error('[Indexer] FATAL:', msg);
    log.error = msg;
    // Reset FIRST - before logging
    await resetRunningState(db);
    await writeRefreshLog(db, mode, 'error', log);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

// ---- processStream ----------------------------------------------------------

type StreamResult = { count: number; pages: number; hasMore: boolean; error?: string };
type AnyPage = {
  data: unknown[];
  nextCursor: { txDigest: string; eventSeq: string } | null;
  hasNextPage: boolean;
};

async function processStream(
  db: ReturnType<typeof getDB>,
  now: string,
  startMs: number,
  streamKey: string,
  fetcher: (cursor: { txDigest: string; eventSeq: string } | null) => Promise<AnyPage>,
  writer:  (page: AnyPage, db: ReturnType<typeof getDB>, now: string) => Promise<number>
): Promise<StreamResult> {
  let totalCount = 0;
  let totalPages = 0;

  try {
    const cp = await getCheckpoint(db, streamKey);
    let cursor = cp?.last_tx_digest
      ? { txDigest: cp.last_tx_digest, eventSeq: cp.last_event_seq || '0' }
      : null;

    while (true) {
      if (Date.now() - startMs > TIME_BUDGET_MS) {
        console.log(`[${streamKey}] Time budget reached after ${totalPages} pages`);
        return { count: totalCount, pages: totalPages, hasMore: true };
      }

      const page = await fetcher(cursor);

      if (page.data.length === 0 && !page.hasNextPage) {
        return { count: totalCount, pages: totalPages, hasMore: false };
      }

      if (page.data.length === 0 && page.hasNextPage) {
        if (page.nextCursor) {
          await saveCheckpoint(db, streamKey, page.nextCursor.txDigest, page.nextCursor.eventSeq);
          cursor = page.nextCursor;
        }
        continue;
      }

      const count = await writer(page, db, now);
      totalCount += count;
      totalPages += 1;

      // Always save checkpoint when there's a next cursor regardless of count.
      // DB-level dedup (onConflict) handles any duplicates safely.
      if (page.nextCursor) {
        await saveCheckpoint(db, streamKey, page.nextCursor.txDigest, page.nextCursor.eventSeq);
        cursor = page.nextCursor;
      }

      if (!page.hasNextPage) {
        return { count: totalCount, pages: totalPages, hasMore: false };
      }
    }
  } catch (err) {
    const msg = errMsg(err);
    console.error(`[processStream:${streamKey}] ERROR:`, msg);
    return { count: totalCount, pages: totalPages, hasMore: true, error: msg };
  }
}

// ---- Aggregate Builder ------------------------------------------------------

async function rebuildAggregates(db: ReturnType<typeof getDB>, now: string) {
  // Paginate active locks
const activeLocks: any[] = [];
let activePage = 0;
while (true) {
  const { data } = await db.from('locks')
    .select('wallet_address,asset_type,lock_duration,ika_amount,isui_amount,locked_at')
    .eq('is_active', true)
    .range(activePage * 1000, activePage * 1000 + 999);
  if (!data || data.length === 0) break;
  activeLocks.push(...data);
  if (data.length < 1000) break;
  activePage++;
}

// Paginate inactive locks
const inactiveLocks: any[] = [];
let inactivePage = 0;
while (true) {
  const { data } = await db.from('locks')
    .select('id')
    .eq('is_active', false)
    .range(inactivePage * 1000, inactivePage * 1000 + 999);
  if (!data || data.length === 0) break;
  inactiveLocks.push(...data);
  if (data.length < 1000) break;
  inactivePage++;
}

// Paginate drizzlets
const histDrz: any[] = [];
let drzPage = 0;
while (true) {
  const { data } = await db.from('drizzlets')
    .select('wallet_address,amount,source')
    .range(drzPage * 1000, drzPage * 1000 + 999);
  if (!data || data.length === 0) break;
  histDrz.push(...data);
  if (data.length < 1000) break;
  drzPage++;
}

  const ts = Date.now();
  let totalIka = 0, totalISUI = 0, totalActiveDrz = 0;
  let isuiDrz = 0, unlockedDrz = 0, riddleDrz = 0;

  type W = { ika: number; isui: number; drizzlets: number; locks: number };
  const wmap: Record<string, W> = {};
  const ensure = (a: string) => {
    if (!wmap[a]) wmap[a] = { ika: 0, isui: 0, drizzlets: 0, locks: 0 };
  };

  for (const lock of activeLocks || []) {
    const days = Math.floor((ts - new Date(lock.locked_at).getTime()) / 86400000);
    ensure(lock.wallet_address);
    if (lock.asset_type === 'isui') {
      const isui = Number(lock.isui_amount);
      const drz  = calcISUIDrizzlets(isui, days);
      totalISUI      += isui;
      totalActiveDrz += drz;
      wmap[lock.wallet_address].isui      += isui;
      wmap[lock.wallet_address].drizzlets += drz;
    } else {
      const ika  = Number(lock.ika_amount);
      const rate = getDrizzletRate(Number(lock.lock_duration) as LockDuration);
      const drz  = calcIkaDrizzlets(ika, days, rate);
      totalIka       += ika;
      totalActiveDrz += drz;
      wmap[lock.wallet_address].ika       += ika;
      wmap[lock.wallet_address].drizzlets += drz;
    }
    wmap[lock.wallet_address].locks += 1;
  }

  for (const d of histDrz || []) {
    ensure(d.wallet_address);
    wmap[d.wallet_address].drizzlets += Number(d.amount);
    if (d.source === 'isui_lock') isuiDrz    += Number(d.amount);
    if (d.source === 'unlock')    unlockedDrz += Number(d.amount);
    if (d.source === 'riddle')    riddleDrz   += Number(d.amount);
  }

  const walletRows = Object.entries(wmap).map(([addr, s]) => ({
    address:         addr,
    ika_locked:      s.ika,
    isui_locked:     s.isui,
    total_drizzlets: s.drizzlets,
    active_locks:    s.locks,
    updated_at:      now,
  }));
  for (const b of chunk(walletRows, BATCH_SIZE)) {
    await withRetry(async () =>
      db.from('wallets').upsert(b, { onConflict: 'address' })
        .then(r => { if (r.error) throw new Error(r.error.message); return r; }),
      'wallets-agg'
    );
  }

  const dist = buildLockDistribution(
    (activeLocks || [])
      .filter(l => l.asset_type === 'ika')
      .map(l => ({
        lock_duration: Number(l.lock_duration) as LockDuration,
        ika_amount:    Number(l.ika_amount),
      }))
  );
  for (const item of dist) {
    await db.from('lock_distribution_cache').upsert(
      {
        duration:   item.duration,
        label:      item.label,
        percentage: item.percentage,
        total_nfts: item.total_nfts,
        total_ika:  item.total_ika,
        rate:       item.rate,
        updated_at: now,
      },
      { onConflict: 'duration' }
    );
  }

  await db.from('drizzlet_distribution_cache').upsert(
    {
      id:                 'main',
      locked_ika_rewards: totalActiveDrz,
      isui_rewards:       isuiDrz,
      unlocked_drizzlets: unlockedDrz,
      riddle_rewards:     riddleDrz,
      updated_at:         now,
    },
    { onConflict: 'id' }
  );

  const totalDrizzlets = totalActiveDrz + unlockedDrz + isuiDrz + riddleDrz;
  const weightedRate = totalIka > 0
    ? (activeLocks || [])
        .filter(l => l.asset_type === 'ika')
        .reduce((sum: number, l: any) => sum + getDrizzletRate(Number(l.lock_duration)) * Number(l.ika_amount), 0)
      / totalIka
    : 3;

  const forecast = forecastDrizzlets(totalDrizzlets, totalIka, totalISUI, weightedRate, 60);

  await db.from('dashboard_cache').upsert(
    {
      id:                       'main',
      total_ika_staked:          totalIka,
      total_isui_staked:         totalISUI,
      total_locked_nfts:         activeLocks?.length   || 0,
      total_unlocked_nfts:       inactiveLocks?.length || 0,
      total_staking_nfts:        (activeLocks?.length || 0) + (inactiveLocks?.length || 0),
      unique_staking_wallets:    Object.keys(wmap).length,
      total_drizzlets_earned:    forecast.current,
      forecast_drizzlets_30d:    forecast.day30,
      forecast_drizzlets_60d:    forecast.day60,
      forecast_drizzlets_season: forecast.season_end,
      last_indexed_at:           now,
      updated_at:                now,
    },
    { onConflict: 'id' }
  );

  console.log(
    `[Agg] IKA:${totalIka.toFixed(0)} iSUI:${totalISUI.toFixed(0)} ` +
    `Drz:${totalDrizzlets.toLocaleString()} Wallets:${Object.keys(wmap).length}`
  );
}
