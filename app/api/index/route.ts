og.success      = true;

    await writeRefreshLog(db, mode, 'success', log);
    console.log(`[Indexer] Done — locks: ${lockCount}, unlocks: ${unlockCount}`);

    return NextResponse.json({ success: true, ...log });

  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error('[Indexer] Fatal error:', errMsg);
    log.error = errMsg;
    await writeRefreshLog(db, mode, 'error', log);
    return NextResponse.json({ success: false, error: errMsg }, { status: 500 });

  } finally {
    await getDB().from('indexer_state').update({
      is_running:  false,
      last_run_at: new Date().toISOString(),
      updated_at:  new Date().toISOString(),
    }).eq('id', 'lock_events');
  }
}

// ─── Aggregate Builder ────────────────────────────────────────────────────────

async function rebuildAggregates(db: ReturnType<typeof getDB>, now: string) {
  const { data: activeLocks }   = await db.from('locks').select('wallet_address,lock_duration,ika_amount,locked_at').eq('is_active', true);
  const { data: inactiveLocks } = await db.from('locks').select('id').eq('is_active', false);

  let totalIka = 0;
  let totalDrizzlets = 0;
  const wmap: Record<string, { ika: number; drizzlets: number; locks: number }> = {};
  const ts = Date.now();

  for (const lock of activeLocks || []) {
    const ika  = Number(lock.ika_amount);
    const dur  = Number(lock.lock_duration) as LockDuration;
    const rate = getDrizzletRate(dur);
    const days = Math.floor((ts - new Date(lock.locked_at).getTime()) / 86400000);
    const drz  = calcIkaDrizzlets(ika, days, rate);

    totalIka        += ika;
    totalDrizzlets  += drz;

    if (!wmap[lock.wallet_address]) wmap[lock.wallet_address] = { ika: 0, drizzlets: 0, locks: 0 };
    wmap[lock.wallet_address].ika       += ika;
    wmap[lock.wallet_address].drizzlets += drz;
    wmap[lock.wallet_address].locks     += 1;
  }

  const { data: histDrz } = await db.from('drizzlets').select('wallet_address,amount,source');
  let isuiRewards = 0, unlockedDrizzlets = 0, riddleRewards = 0;

  for (const d of histDrz || []) {
    if (!wmap[d.wallet_address]) wmap[d.wallet_address] = { ika: 0, drizzlets: 0, locks: 0 };
    wmap[d.wallet_address].drizzlets += Number(d.amount);
    if (d.source === 'isui_lock') isuiRewards      += Number(d.amount);
    if (d.source === 'unlock')    unlockedDrizzlets += Number(d.amount);
    if (d.source === 'riddle')    riddleRewards     += Number(d.amount);
  }

  // Batch wallet updates
  const walletUpdates = Object.entries(wmap).map(([addr, s]) => ({
    address: addr, ika_locked: s.ika, total_drizzlets: s.drizzlets,
    active_locks: s.locks, updated_at: now,
  }));

  for (const batch of chunk(walletUpdates, BATCH_SIZE)) {
    await withRetry(
      () => db.from('wallets').upsert(batch, { onConflict: 'address' }).then(r => { if (r.error) throw r.error; return r; }),
      'wallets-aggregate-upsert'
    );
  }

  // Lock distribution
  const dist = buildLockDistribution(
    (activeLocks || []).map(l => ({ lock_duration: Number(l.lock_duration) as LockDuration, ika_amount: Number(l.ika_amount) }))
  );
  for (const item of dist) {
    await db.from('lock_distribution_cache').upsert({
      duration: item.duration, label: item.label, percentage: item.percentage,
      total_nfts: item.total_nfts, total_ika: item.total_ika, rate: item.rate, updated_at: now,
    }, { onConflict: 'duration' });
  }

  // Drizzlet distribution
  await db.from('drizzlet_distribution_cache').upsert({
    id: 'main', locked_ika_rewards: totalDrizzlets, isui_rewards: isuiRewards,
    unlocked_drizzlets: unlockedDrizzlets, riddle_rewards: riddleRewards, updated_at: now,
  }, { onConflict: 'id' });

  // Dashboard cache
  const forecast = forecastDrizzlets(totalDrizzlets + unlockedDrizzlets, totalIka, 0, 3, 60);
  await db.from('dashboard_cache').upsert({
    id: 'main', total_ika_staked: totalIka, total_isui_staked: 0,
    total_locked_nfts: activeLocks?.length || 0,
    total_unlocked_nfts: inactiveLocks?.length || 0,
    total_staking_nfts: (activeLocks?.length || 0) + (inactiveLocks?.length || 0),
    unique_staking_wallets: Object.keys(wmap).length,
    total_drizzlets_earned: forecast.current,
    forecast_drizzlets_30d: forecast.day30,
    forecast_drizzlets_60d: forecast.day60,
    forecast_drizzlets_season: forecast.season_end,
    last_indexed_at: now, updated_at: now,
  }, { onConflict: 'id' });
          }    const auth = req.headers.get('authorization') || '';
    const qs   = req.nextUrl.searchParams.get('secret') || '';
    const cron = req.headers.get('x-vercel-cron') === '1';
    if (auth !== `Bearer ${secret}` && qs !== secret && !cron) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

  const db = getDB();
  const { data: st } = await db.from('indexer_state').select('is_running').eq('id', 'lock_events').single();
  if (st?.is_running) return NextResponse.json({ message: 'Already running' }, { status: 409 });

  await db.from('indexer_state').update({ is_running: true, updated_at: new Date().toISOString() }).eq('id', 'lock_events');

  try {
    let lockCount = 0;

    const lockPage = await rpc<{
      data: Array<{ id: { txDigest: string }; parsedJson: Record<string, unknown>; timestampMs: string }>
    }>('suix_queryEvents', [
      { MoveEventType: `${PKG}::ika_staking::LockStakeIka` }, null, 50, false,
    ]);

    for (const event of lockPage?.data ?? []) {
      const wallet   = String(event.parsedJson.sender || '');
      const ika      = Number(String(event.parsedJson.staked_ika_balance || '0')) / 1e9;
      const dur      = parseInt(String(event.parsedJson.lock_duration || '0'));
      const lockedAt = event.timestampMs ? new Date(parseInt(event.timestampMs)).toISOString() : new Date().toISOString();
      if (!wallet) continue;
      await db.from('wallets').upsert({ address: wallet, last_active_at: lockedAt }, { onConflict: 'address', ignoreDuplicates: false });
      const { error: le } = await db.from('locks').upsert({
        wallet_address: wallet, tx_digest: event.id.txDigest,
        lock_duration: dur, ika_amount: ika, locked_at: lockedAt,
        is_active: true, nft_id: String(event.parsedJson.nft_id || ''),
      }, { onConflict: 'tx_digest', ignoreDuplicates: true });
      if (!le) lockCount++;
    }

    const unlockPage = await rpc<{
      data: Array<{ id: { txDigest: string }; parsedJson: Record<string, unknown>; timestampMs: string }>
    }>('suix_queryEvents', [
      { MoveEventType: `${PKG}::ika_staking::UnlockStakedIka` }, null, 50, false,
    ]);

    for (const event of unlockPage?.data ?? []) {
      const wallet     = String(event.parsedJson.sender || '');
      const drizzlets  = Number(String(event.parsedJson.drizzlets_earned || '0'));
      const nftId      = String(event.parsedJson.nft_id || '');
      const unlockedAt = event.timestampMs ? new Date(parseInt(event.timestampMs)).toISOString() : new Date().toISOString();
      if (!wallet) continue;
      await db.from('locks').update({ is_active: false, unlocked_at: unlockedAt, drizzlets_earned: drizzlets, updated_at: new Date().toISOString() }).eq('nft_id', nftId).eq('is_active', true);
      await db.from('drizzlets').insert({ wallet_address: wallet, source: 'unlock', amount: drizzlets, reference_id: event.id.txDigest, earned_at: unlockedAt });
    }

    const { data: activeLocks }   = await db.from('locks').select('wallet_address,lock_duration,ika_amount,locked_at').eq('is_active', true);
    const { data: inactiveLocks } = await db.from('locks').select('id').eq('is_active', false);
    const now = Date.now();
    let totalIka = 0;
    let totalDrizzlets = 0;
    const wmap: Record<string, { ika: number; drizzlets: number; locks: number }> = {};

    for (const lock of activeLocks || []) {
      const ika  = Number(lock.ika_amount);
      const dur  = Number(lock.lock_duration);
      const rate = getDrizzletRate(dur);
      const days = Math.floor((now - new Date(lock.locked_at).getTime()) / 86400000);
      const drz  = (ika / 10) * rate * days;
      totalIka += ika;
      totalDrizzlets += drz;
      if (!wmap[lock.wallet_address]) wmap[lock.wallet_address] = { ika: 0, drizzlets: 0, locks: 0 };
      wmap[lock.wallet_address].ika       += ika;
      wmap[lock.wallet_address].drizzlets += drz;
      wmap[lock.wallet_address].locks     += 1;
    }

    const { data: histDrz } = await db.from('drizzlets').select('wallet_address,amount');
    for (const d of histDrz || []) {
      if (!wmap[d.wallet_address]) wmap[d.wallet_address] = { ika: 0, drizzlets: 0, locks: 0 };
      wmap[d.wallet_address].drizzlets += Number(d.amount);
    }

    for (const [addr, s] of Object.entries(wmap)) {
      await db.from('wallets').upsert({ address: addr, ika_locked: s.ika, total_drizzlets: s.drizzlets, active_locks: s.locks, updated_at: new Date().toISOString() }, { onConflict: 'address' });
    }

    const dailyTotal = (totalIka / 10) * 3;
    await db.from('dashboard_cache').upsert({
      id: 'main', total_ika_staked: totalIka, total_isui_staked: 0,
      total_locked_nfts: activeLocks?.length || 0,
      total_unlocked_nfts: inactiveLocks?.length || 0,
      total_staking_nfts: (activeLocks?.length || 0) + (inactiveLocks?.length || 0),
      unique_staking_wallets: Object.keys(wmap).length,
      total_drizzlets_earned: Math.round(totalDrizzlets),
      forecast_drizzlets_30d: Math.round(totalDrizzlets + dailyTotal * 30),
      forecast_drizzlets_60d: Math.round(totalDrizzlets + dailyTotal * 60),
      forecast_drizzlets_season: Math.round(totalDrizzlets + dailyTotal * 60),
      last_indexed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'id' });

    return NextResponse.json({ success: true, new_locks: lockCount, ran_at: new Date().toISOString() });
  } catch (err) {
    console.error('[Indexer]', err instanceof Error ? err.message : 'unknown');
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  } finally {
    await getDB().from('indexer_state').update({ is_running: false, last_run_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', 'lock_events');
  }
}
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
  fetchRiddlePool,
  toHumanIka,
  getDrizzletRate,
  calcIkaDrizzlets,
} from '@/lib/sui-rpc';
import { buildLockDistribution, forecastDrizzlets } from '@/lib/calculations';
import { LockDuration } from '@/lib/types';

// ─── Config ───────────────────────────────────────────────────────────────────

const BATCH_SIZE      = 25;   // upserts per batch
const RATE_LIMIT_WAIT = 2000; // ms to wait on 429
const MAX_RETRIES     = 3;

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
  const auth  = req.headers.get('authorization') || '';
  const qs    = req.nextUrl.searchParams.get('secret') || '';
  const cron  = req.headers.get('x-vercel-cron') === '1';
  return auth === `Bearer ${secret}` || qs === secret || cron;
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

// Batch array into chunks
function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// Retry wrapper with rate-limit backoff
async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T | null> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const msg = String(err);
      const isRateLimit = msg.includes('429') || msg.includes('Too Many');
      console.warn(`[${label}] attempt ${attempt} failed: ${msg}`);
      if (isRateLimit && attempt < MAX_RETRIES) {
        await sleep(RATE_LIMIT_WAIT * attempt);
        continue;
      }
      if (attempt === MAX_RETRIES) return null;
    }
  }
  return null;
}

// ─── Main Handler ─────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // mode=full resets checkpoints and reindexes everything
  const mode = req.nextUrl.searchParams.get('mode') === 'full' ? 'full' : 'checkpoint';
  const db   = getDB();
  const now  = new Date().toISOString();
  const log: Record<string, unknown> = { mode, started_at: now };

  // Prevent concurrent runs
  const { data: st } = await db
    .from('indexer_state').select('is_running').eq('id', 'lock_events').single();
  if (st?.is_running) {
    return NextResponse.json({ message: 'Already running' }, { status: 409 });
  }

  await db.from('indexer_state')
    .update({ is_running: true, updated_at: now }).eq('id', 'lock_events');

  try {
    console.log(`[Indexer] Starting — mode: ${mode}`);

    // ── Full mode: wipe checkpoints so we re-read all events ─────────────────
    if (mode === 'full') {
      await clearCheckpoint(db, 'lock_events');
      await clearCheckpoint(db, 'unlock_events');
      console.log('[Indexer] Full mode — checkpoints cleared');
    }

    // ── 1. Lock Events ────────────────────────────────────────────────────────
    const lockCp = await getCheckpoint(db, 'lock_events');
    const lockCursor = lockCp?.last_tx_digest
      ? { txDigest: lockCp.last_tx_digest, eventSeq: lockCp.last_event_seq || '0' }
      : null;

    let lockPage   = await fetchLockStakeEvents(lockCursor);
    let lockCount  = 0;
    let lastLockCursor = lockCursor;

    while (lockPage.data.length > 0) {
      // Batch wallet upserts
      const walletBatch = lockPage.data.map(e => ({
        address:        e.sender,
        last_active_at: e.timestampMs
          ? new Date(parseInt(e.timestampMs)).toISOString()
          : now,
      }));

      for (const batch of chunk(walletBatch, BATCH_SIZE)) {
        await withRetry(
          () => db.from('wallets').upsert(batch, { onConflict: 'address', ignoreDuplicates: false }).then(r => { if (r.error) throw r.error; return r; }),
          'wallets-upsert'
        );
      }

      // Batch lock upserts
      const lockBatch = lockPage.data.map(e => ({
        wallet_address: e.sender,
        tx_digest:      e.txDigest,
        lock_duration:  parseInt(e.lock_duration || '0') as LockDuration,
        ika_amount:     toHumanIka(e.staked_ika_balance || '0'),
        locked_at:      e.timestampMs ? new Date(parseInt(e.timestampMs)).toISOString() : now,
        is_active:      true,
        nft_id:         e.nft_id || null,
      }));

      for (const batch of chunk(lockBatch, BATCH_SIZE)) {
        const result = await withRetry(
          () => db.from('locks').upsert(batch, { onConflict: 'tx_digest', ignoreDuplicates: true }).then(r => { if (r.error) throw r.error; return r; }),
          'locks-upsert'
        );
        if (result !== null) lockCount += batch.length;
      }

      if (!lockPage.hasNextPage || !lockPage.nextCursor) break;
      lastLockCursor = lockPage.nextCursor;
      lockPage = await fetchLockStakeEvents(lockPage.nextCursor);
    }

    // Save checkpoint
    if (lastLockCursor && lastLockCursor !== lockCursor) {
      await saveCheckpoint(db, 'lock_events', lastLockCursor.txDigest, lastLockCursor.eventSeq);
    }

    log.new_locks = lockCount;
    console.log(`[Indexer] Lock events processed: ${lockCount}`);

    // ── 2. Unlock Events ──────────────────────────────────────────────────────
    const unlockCp = await getCheckpoint(db, 'unlock_events');
    const unlockCursor = unlockCp?.last_tx_digest
      ? { txDigest: unlockCp.last_tx_digest, eventSeq: unlockCp.last_event_seq || '0' }
      : null;

    let unlockPage = await fetchUnlockEvents(unlockCursor);
    let unlockCount = 0;
    let lastUnlockCursor = unlockCursor;

    while (unlockPage.data.length > 0) {
      for (const event of unlockPage.data) {
        const unlockedAt = event.unlock_time_ts
          ? new Date(parseInt(event.unlock_time_ts)).toISOString()
          : now;
        const drizzlets = Number(event.drizzlets_earned || '0');

        await withRetry(
          () => db.from('locks')
            .update({ is_active: false, unlocked_at: unlockedAt, drizzlets_earned: drizzlets, updated_at: now })
            .eq('nft_id', event.nft_id || '')
            .eq('is_active', true)
            .then(r => { if (r.error) throw r.error; return r; }),
          'locks-update-unlock'
        );

        await withRetry(
          () => db.from('drizzlets')
            .insert({ wallet_address: event.sender, source: 'unlock', amount: drizzlets, reference_id: event.txDigest, earned_at: unlockedAt })
            .then(r => { if (r.error && !String(r.error).includes('duplicate') ) throw r.error; return r; }),
          'drizzlets-insert'
        );

        unlockCount++;
      }

      if (!unlockPage.hasNextPage || !unlockPage.nextCursor) break;
      lastUnlockCursor = unlockPage.nextCursor;
      unlockPage = await fetchUnlockEvents(unlockPage.nextCursor);
    }

    if (lastUnlockCursor && lastUnlockCursor !== unlockCursor) {
      await saveCheckpoint(db, 'unlock_events', lastUnlockCursor.txDigest, lastUnlockCursor.eventSeq);
    }

    log.new_unlocks = unlockCount;
    console.log(`[Indexer] Unlock events processed: ${unlockCount}`);

    // ── 3. Riddle Pool ────────────────────────────────────────────────────────
    const riddleRaw = await withRetry(() => fetchRiddlePool() as Promise<{ pool1: string; pool2: string; pool3: string } | null>, 'riddle-pool');
    if (riddleRaw) {
      const p1 = toHumanIka(riddleRaw.pool1);
      const p2 = toHumanIka(riddleRaw.pool2);
      const p3 = toHumanIka(riddleRaw.pool3);
      await Promise.all([
        db.from('riddle_pools').upsert({ pool_index: 1, amount: p1, raw_amount: riddleRaw.pool1, fetched_at: now }, { onConflict: 'pool_index' }),
        db.from('riddle_pools').upsert({ pool_index: 2, amount: p2, raw_amount: riddleRaw.pool2, fetched_at: now }, { onConflict: 'pool_index' }),
        db.from('riddle_pools').upsert({ pool_index: 3, amount: p3, raw_amount: riddleRaw.pool3, fetched_at: now }, { onConflict: 'pool_index' }),
      ]);
      log.riddle_fetched = true;
    }

    // ── 4. Rebuild Aggregates (atomic) ────────────────────────────────────────
    await rebuildAggregates(db, now);

    log.completed_at = new Date().toISOString();
    log.success      = true;

    await writeRefreshLog(db, mode, 'success', log);
    console.log(`[Indexer] Done — locks: ${lockCount}, unlocks: ${unlockCount}`);

    return NextResponse.json({ success: true, ...log });

  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error('[Indexer] Fatal error:', errMsg);
    log.error = errMsg;
    await writeRefreshLog(db, mode, 'error', log);
    return NextResponse.json({ success: false, error: errMsg }, { status: 500 });

  } finally {
    await getDB().from('indexer_state').update({
      is_running:  false,
      last_run_at: new Date().toISOString(),
      updated_at:  new Date().toISOString(),
    }).eq('id', 'lock_events');
  }
}

// ─── Aggregate Builder ────────────────────────────────────────────────────────

async function rebuildAggregates(db: ReturnType<typeof getDB>, now: string) {
  const { data: activeLocks }   = await db.from('locks').select('wallet_address,lock_duration,ika_amount,locked_at').eq('is_active', true);
  const { data: inactiveLocks } = await db.from('locks').select('id').eq('is_active', false);

  let totalIka = 0;
  let totalDrizzlets = 0;
  const wmap: Record<string, { ika: number; drizzlets: number; locks: number }> = {};
  const ts = Date.now();

  for (const lock of activeLocks || []) {
    const ika  = Number(lock.ika_amount);
    const dur  = Number(lock.lock_duration) as LockDuration;
    const rate = getDrizzletRate(dur);
    const days = Math.floor((ts - new Date(lock.locked_at).getTime()) / 86400000);
    const drz  = calcIkaDrizzlets(ika, days, rate);

    totalIka        += ika;
    totalDrizzlets  += drz;

    if (!wmap[lock.wallet_address]) wmap[lock.wallet_address] = { ika: 0, drizzlets: 0, locks: 0 };
    wmap[lock.wallet_address].ika       += ika;
    wmap[lock.wallet_address].drizzlets += drz;
    wmap[lock.wallet_address].locks     += 1;
  }

  const { data: histDrz } = await db.from('drizzlets').select('wallet_address,amount,source');
  let isuiRewards = 0, unlockedDrizzlets = 0, riddleRewards = 0;

  for (const d of histDrz || []) {
    if (!wmap[d.wallet_address]) wmap[d.wallet_address] = { ika: 0, drizzlets: 0, locks: 0 };
    wmap[d.wallet_address].drizzlets += Number(d.amount);
    if (d.source === 'isui_lock') isuiRewards      += Number(d.amount);
    if (d.source === 'unlock')    unlockedDrizzlets += Number(d.amount);
    if (d.source === 'riddle')    riddleRewards     += Number(d.amount);
  }

  // Batch wallet updates
  const walletUpdates = Object.entries(wmap).map(([addr, s]) => ({
    address: addr, ika_locked: s.ika, total_drizzlets: s.drizzlets,
    active_locks: s.locks, updated_at: now,
  }));

  for (const batch of chunk(walletUpdates, BATCH_SIZE)) {
    await withRetry(
      () => db.from('wallets').upsert(batch, { onConflict: 'address' }).then(r => { if (r.error) throw r.error; return r; }),
      'wallets-aggregate-upsert'
    );
  }

  // Lock distribution
  const dist = buildLockDistribution(
    (activeLocks || []).map(l => ({ lock_duration: Number(l.lock_duration) as LockDuration, ika_amount: Number(l.ika_amount) }))
  );
  for (const item of dist) {
    await db.from('lock_distribution_cache').upsert({
      duration: item.duration, label: item.label, percentage: item.percentage,
      total_nfts: item.total_nfts, total_ika: item.total_ika, rate: item.rate, updated_at: now,
    }, { onConflict: 'duration' });
  }

  // Drizzlet distribution
  await db.from('drizzlet_distribution_cache').upsert({
    id: 'main', locked_ika_rewards: totalDrizzlets, isui_rewards: isuiRewards,
    unlocked_drizzlets: unlockedDrizzlets, riddle_rewards: riddleRewards, updated_at: now,
  }, { onConflict: 'id' });

  // Dashboard cache
  const forecast = forecastDrizzlets(totalDrizzlets + unlockedDrizzlets, totalIka, 0, 3, 60);
  await db.from('dashboard_cache').upsert({
    id: 'main', total_ika_staked: totalIka, total_isui_staked: 0,
    total_locked_nfts: activeLocks?.length || 0,
    total_unlocked_nfts: inactiveLocks?.length || 0,
    total_staking_nfts: (activeLocks?.length || 0) + (inactiveLocks?.length || 0),
    unique_staking_wallets: Object.keys(wmap).length,
    total_drizzlets_earned: forecast.current,
    forecast_drizzlets_30d: forecast.day30,
    forecast_drizzlets_60d: forecast.day60,
    forecast_drizzlets_season: forecast.season_end,
    last_indexed_at: now, updated_at: now,
  }, { onConflict: 'id' });
  }
