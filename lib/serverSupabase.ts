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

// ─── Drizzlet Breakdown (pie chart) ──────────────────────────────────────────

export interface DrizzletBreakdown {
  locked_ika:    number;
  unlocked_ika:  number;
  locked_isui:   number;
  unlocked_isui: number;
  nft_reveals:   number;
  riddle:        number;
}

export async function serverGetDrizzletBreakdown(): Promise<DrizzletBreakdown> {
  const zero = { locked_ika: 0, unlocked_ika: 0, locked_isui: 0, unlocked_isui: 0, nft_reveals: 0, riddle: 0 };
  try {
    const db  = getAdminClient();
    const now = Date.now();

    // RPC for aggregates — bypasses PostgREST 1000-row cap
    const { data: agg } = await db.rpc('get_drizzlet_breakdown');
    const a = agg as {
      unlocked_ika:  number;
      unlocked_isui: number;
      nft_reveals:   number;
      riddle_sub:    number;
      riddle_pools:  number;
    };

    // Locked drizzlets calculated live from active locks — paginated to bypass row cap
    let locked_ika = 0, locked_isui = 0;
    let from = 0;
    const pageSize = 1000;
    while (true) {
      const { data: page } = await db.from('locks')
        .select('asset_type, lock_duration, ika_amount, isui_amount, locked_at')
        .eq('is_active', true)
        .range(from, from + pageSize - 1);
      if (!page || page.length === 0) break;
      for (const lock of page) {
        const days = Math.floor((now - new Date(lock.locked_at).getTime()) / 86400000);
        if (lock.asset_type === 'isui') {
          locked_isui += Math.floor((Number(lock.isui_amount) / 10) * 5 * Math.max(0, days));
        } else {
          const rateMap: Record<string, number> = { '0': 5, '1': 1, '7': 2, '30': 3 };
          const rate = rateMap[String(lock.lock_duration)] ?? 5;
          locked_ika += Math.floor((Number(lock.ika_amount) / 10) * rate * Math.max(0, days));
        }
      }
      if (page.length < pageSize) break;
      from += pageSize;
    }

    return {
      locked_ika,
      unlocked_ika:  Number(a?.unlocked_ika  || 0),
      locked_isui,
      unlocked_isui: Number(a?.unlocked_isui || 0),
      nft_reveals:   Number(a?.nft_reveals   || 0),
      riddle:        Number(a?.riddle_sub    || 0) + Number(a?.riddle_pools || 0),
    };
  } catch { return zero; }
}

// ─── Riddle Stats ─────────────────────────────────────────────────────────────

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
      db.from('wallet_user_tasks')
        .select('riddle_one_solved, riddle_two_solved, riddle_three_solved')
        .limit(10000),
    ]);
    const tasks = taskRes.data || [];
    return {
      total_submissions: subRes.count || 0,
      r1_solvers:    tasks.filter((t: { riddle_one_solved:   boolean }) => t.riddle_one_solved).length,
      r2_solvers:    tasks.filter((t: { riddle_two_solved:   boolean }) => t.riddle_two_solved).length,
      r3_solvers:    tasks.filter((t: { riddle_three_solved: boolean }) => t.riddle_three_solved).length,
      total_wallets: tasks.length,
    };
  } catch { return { total_submissions: 0, r1_solvers: 0, r2_solvers: 0, r3_solvers: 0, total_wallets: 0 }; }
}

// ─── NFT Stats ────────────────────────────────────────────────────────────────

export interface NftStats {
  total_reveals:   number;
  total_drizzlets: number;
  avg_per_reveal:  number;
  unique_wallets:  number;
}

export async function serverGetNftStats(): Promise<NftStats> {
  try {
    const db = getAdminClient();
    const { data } = await db.rpc('get_nft_stats');
    const d = data as { total_reveals: number; total_drizzlets: number; avg_per_reveal: number; unique_wallets: number };
    return {
      total_reveals:   Number(d?.total_reveals   || 0),
      total_drizzlets: Number(d?.total_drizzlets || 0),
      avg_per_reveal:  Number(d?.avg_per_reveal  || 0),
      unique_wallets:  Number(d?.unique_wallets  || 0),
    };
  } catch { return { total_reveals: 0, total_drizzlets: 0, avg_per_reveal: 0, unique_wallets: 0 }; }
}

// ─── Community Code Stats ─────────────────────────────────────────────────────

export interface CodeStats {
  wallets_with_code: number;
  unique_codes:      number;
}

export async function serverGetCodeStats(): Promise<CodeStats> {
  try {
    const db = getAdminClient();
    const { data } = await db.rpc('get_code_stats');
    const d = data as { wallets_with_code: number; unique_codes: number };
    return {
      wallets_with_code: Number(d?.wallets_with_code || 0),
      unique_codes:      Number(d?.unique_codes      || 0),
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

// ─── Token Prices ─────────────────────────────────────────────────────────────

export interface Prices {
  ika: number | null;
  sui: number | null;
}

export async function serverGetPrices(): Promise<Prices> {
  return { ika: null, sui: null };
}

// ─── Indexer helpers (used by route.ts) ──────────────────────────────────────

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
