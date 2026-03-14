/**
 * Server-only data fetchers — called directly from Server Components.
 * Uses service-role key for reads so RLS does not block anything.
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js';

export function getAdminClient() {
  const url  = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key  = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Missing Supabase env vars');
  return createClient(url, key, { auth: { persistSession: false } });
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

export interface DashboardRow {
  total_ika_staked:          number;
  total_isui_staked:         number;
  total_locked_nfts:         number;
  total_unlocked_nfts:       number;
  total_staking_nfts:        number;
  unique_staking_wallets:    number;
  total_drizzlets_earned:    number;
  forecast_drizzlets_30d:    number;
  forecast_drizzlets_60d:    number;
  forecast_drizzlets_season: number;
  last_indexed_at:           string | null;
}

export async function serverGetDashboard(): Promise<DashboardRow | null> {
  try {
    const db = getAdminClient();
    const { data, error } = await db
      .from('dashboard_cache')
      .select('*')
      .eq('id', 'main')
      .single();
    if (error) throw error;
    return data as DashboardRow;
  } catch { return null; }
}

export async function serverGetRiddlePools() {
  try {
    const db = getAdminClient();
    const { data } = await db
      .from('riddle_pools')
      .select('pool_index, amount, fetched_at')
      .order('pool_index');
    const pools = data || [];
    return {
      pool1:      Number(pools.find((p: { pool_index: number }) => p.pool_index === 1)?.amount ?? 0),
      pool2:      Number(pools.find((p: { pool_index: number }) => p.pool_index === 2)?.amount ?? 0),
      pool3:      Number(pools.find((p: { pool_index: number }) => p.pool_index === 3)?.amount ?? 0),
      total:      pools.reduce((s: number, p: { amount: number }) => s + Number(p.amount), 0),
      fetched_at: pools[0]?.fetched_at ?? null,
    };
  } catch { return { pool1: 0, pool2: 0, pool3: 0, total: 0, fetched_at: null }; }
}

export async function serverGetLockDist() {
  try {
    const db = getAdminClient();
    const { data } = await db
      .from('lock_distribution_cache')
      .select('*')
      .order('duration');
    return data ?? [];
  } catch { return []; }
}

export async function serverGetDrizzletDist() {
  try {
    const db = getAdminClient();
    const { data } = await db
      .from('drizzlet_distribution_cache')
      .select('*')
      .eq('id', 'main')
      .single();
    return data ?? { locked_ika_rewards: 0, isui_rewards: 0, unlocked_drizzlets: 0, riddle_rewards: 0 };
  } catch { return { locked_ika_rewards: 0, isui_rewards: 0, unlocked_drizzlets: 0, riddle_rewards: 0 }; }
}

// ─── Drizzlet Breakdown (for pie chart) ──────────────────────────────────────
// Queries live data to split locked IKA / locked iSUI / unlocked IKA /
// unlocked iSUI / NFT reveals / riddle separately

export interface DrizzletBreakdown {
  locked_ika:    number;  // active IKA lock drizzlets (calculated)
  unlocked_ika:  number;  // source='unlock'
  locked_isui:   number;  // active iSUI lock drizzlets (calculated)
  unlocked_isui: number;  // source='isui_lock'
  nft_reveals:   number;  // source='nft_reveal'
  riddle:        number;  // source='riddle'
}

export async function serverGetDrizzletBreakdown(): Promise<DrizzletBreakdown> {
  const zero = { locked_ika: 0, unlocked_ika: 0, locked_isui: 0, unlocked_isui: 0, nft_reveals: 0, riddle: 0 };
  try {
    const db  = getAdminClient();
    const now = Date.now();

    const [lockRes, drzRes] = await Promise.all([
      db.from('locks')
        .select('asset_type, lock_duration, ika_amount, isui_amount, locked_at')
        .eq('is_active', true),
      db.from('drizzlets')
        .select('source, amount'),
    ]);

    // Calculate locked drizzlets from active positions
    let locked_ika  = 0;
    let locked_isui = 0;
    for (const lock of (lockRes.data || [])) {
      const days = Math.floor((now - new Date(lock.locked_at).getTime()) / 86400000);
      if (lock.asset_type === 'isui') {
        locked_isui += Math.floor((Number(lock.isui_amount) / 10) * 5 * Math.max(0, days));
      } else {
        const rateMap: Record<string, number> = { '0': 5, '1': 1, '7': 2, '30': 3 };
        const rate = rateMap[String(lock.lock_duration)] ?? 5;
        locked_ika += Math.floor((Number(lock.ika_amount) / 10) * rate * Math.max(0, days));
      }
    }

    // Sum historical drizzlets by source
    let unlocked_ika = 0, unlocked_isui = 0, nft_reveals = 0, riddle = 0;
    for (const d of (drzRes.data || [])) {
      const amt = Number(d.amount);
      if      (d.source === 'unlock')     unlocked_ika  += amt;
      else if (d.source === 'isui_lock')  unlocked_isui += amt;
      else if (d.source === 'nft_reveal') nft_reveals   += amt;
      else if (d.source === 'riddle')     riddle        += amt;
    }

    return { locked_ika, unlocked_ika, locked_isui, unlocked_isui, nft_reveals, riddle };
  } catch { return zero; }
}



export interface RiddleStats {
  total_submissions: number;
  r1_solvers:        number;
  r2_solvers:        number;
  r3_solvers:        number;
  total_wallets:     number;
}

export async function serverGetRiddleStats(): Promise<RiddleStats> {
  try {
    const db = getAdminClient();
    const [subRes, taskRes] = await Promise.all([
      db.from('riddle_submissions').select('id', { count: 'exact', head: true }),
      db.from('wallet_user_tasks').select('riddle_one_solved, riddle_two_solved, riddle_three_solved'),
    ]);
    const tasks = taskRes.data || [];
    return {
      total_submissions: subRes.count  || 0,
      r1_solvers: tasks.filter((t: { riddle_one_solved: boolean }) => t.riddle_one_solved).length,
      r2_solvers: tasks.filter((t: { riddle_two_solved: boolean }) => t.riddle_two_solved).length,
      r3_solvers: tasks.filter((t: { riddle_three_solved: boolean }) => t.riddle_three_solved).length,
      total_wallets: tasks.length,
    };
  } catch { return { total_submissions: 0, r1_solvers: 0, r2_solvers: 0, r3_solvers: 0, total_wallets: 0 }; }
}

// ─── NFT Stats ────────────────────────────────────────────────────────────────

export interface NftStats {
  total_reveals:    number;
  total_drizzlets:  number;
  avg_per_reveal:   number;
}

export async function serverGetNftStats(): Promise<NftStats> {
  try {
    const db = getAdminClient();
    const { data } = await db
      .from('drizzlets')
      .select('amount')
      .eq('source', 'nft_reveal');
    const rows  = data || [];
    const total = rows.reduce((s: number, r: { amount: number }) => s + Number(r.amount), 0);
    return {
      total_reveals:   rows.length,
      total_drizzlets: total,
      avg_per_reveal:  rows.length > 0 ? Math.round(total / rows.length) : 0,
    };
  } catch { return { total_reveals: 0, total_drizzlets: 0, avg_per_reveal: 0 }; }
}

// ─── Community Code Stats ─────────────────────────────────────────────────────

export interface CodeStats {
  wallets_with_code: number;
  unique_codes:      number;
}

export async function serverGetCodeStats(): Promise<CodeStats> {
  try {
    const db = getAdminClient();
    const { data } = await db
      .from('wallet_user_tasks')
      .select('community_code')
      .not('community_code', 'is', null);
    const rows = data || [];
    const uniqueCodes = new Set(
      rows
        .map((r: { community_code: string | null }) => r.community_code?.trim().toLowerCase())
        .filter(Boolean)
    );
    return {
      wallets_with_code: rows.length,
      unique_codes:      uniqueCodes.size,
    };
  } catch { return { wallets_with_code: 0, unique_codes: 0 }; }
}

// ─── Top Earners ──────────────────────────────────────────────────────────────

export interface TopEarner {
  rank:            number;
  address:         string;
  ika_locked:      number;
  total_drizzlets: number;
}

export async function serverGetTopEarners(limit = 3): Promise<TopEarner[]> {
  try {
    const db = getAdminClient();
    const { data } = await db
      .from('wallets')
      .select('address, ika_locked, total_drizzlets')
      .gt('total_drizzlets', 0)
      .order('total_drizzlets', { ascending: false })
      .limit(limit);
    return (data || []).map((w: { address: string; ika_locked: number; total_drizzlets: number }, i: number) => ({
      rank:            i + 1,
      address:         w.address,
      ika_locked:      Number(w.ika_locked),
      total_drizzlets: Number(w.total_drizzlets),
    }));
  } catch { return []; }
}

// ─── Token Prices (CoinGecko) ─────────────────────────────────────────────────

export interface Prices {
  ika: number | null;
  sui: number | null;
}

export async function serverGetPrices(): Promise<Prices> {
  try {
    const ikaId = process.env.IKA_COINGECKO_ID || 'ika';
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=sui%2C${ikaId}&vs_currencies=usd`,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { next: { revalidate: 300 } } as any
    );
    if (!res.ok) return { ika: null, sui: null };
    const json = await res.json() as Record<string, { usd?: number }>;
    return {
      ika: json[ikaId]?.usd ?? null,
      sui: json['sui']?.usd   ?? null,
    };
  } catch { return { ika: null, sui: null }; }
}

// ─── Checkpoint / Refresh Log helpers (used by indexer) ──────────────────────

export async function getCheckpoint(db: SupabaseClient, eventType: string) {
  const { data } = await db
    .from('indexer_checkpoints')
    .select('last_tx_digest, last_event_seq')
    .eq('event_type', eventType)
    .single();
  return data ?? null;
}

export async function saveCheckpoint(
  db: SupabaseClient,
  eventType: string,
  txDigest: string,
  eventSeq: string
) {
  await db.from('indexer_checkpoints').upsert(
    { event_type: eventType, last_tx_digest: txDigest, last_event_seq: eventSeq, updated_at: new Date().toISOString() },
    { onConflict: 'event_type' }
  );
}

export async function clearCheckpoint(db: SupabaseClient, eventType: string) {
  await db.from('indexer_checkpoints').delete().eq('event_type', eventType);
}

export async function writeRefreshLog(
  db: SupabaseClient,
  mode: string,
  status: string,
  log: Record<string, unknown>
) {
  await db.from('refresh_logs').insert({
    mode,
    status,
    log,
    created_at: new Date().toISOString(),
  });
}
