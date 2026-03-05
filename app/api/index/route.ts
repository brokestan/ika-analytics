import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function getDB() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

const RPC = process.env.SUI_RPC_URL || 'https://fullnode.mainnet.sui.io:443';
const PKG = process.env.IKA_PACKAGE_ID || '';

async function rpc<T>(method: string, params: unknown[]): Promise<T | null> {
  try {
    const r = await fetch(RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    const j = await r.json() as { result?: T };
    return j.result ?? null;
  } catch { return null; }
}

function getDrizzletRate(d: number): number {
  if (d === 1)  return 1;
  if (d === 7)  return 2;
  if (d === 30) return 3;
  return 5;
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get('authorization') || '';
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
