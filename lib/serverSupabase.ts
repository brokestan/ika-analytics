import { createClient } from '@supabase/supabase-js';

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Missing Supabase env vars');
  return createClient(url, key, { auth: { persistSession: false } });
}

export interface DashboardRow {
  total_ika_staked: number; total_isui_staked: number;
  total_locked_nfts: number; total_unlocked_nfts: number;
  total_staking_nfts: number; unique_staking_wallets: number;
  total_drizzlets_earned: number; forecast_drizzlets_30d: number;
  forecast_drizzlets_60d: number; forecast_drizzlets_season: number;
  last_indexed_at: string | null;
}

export async function serverGetDashboard(): Promise<DashboardRow | null> {
  try {
    const { data, error } = await getAdminClient()
      .from('dashboard_cache').select('*').eq('id', 'main').single();
    if (error) throw error;
    return data as DashboardRow;
  } catch { return null; }
}

export async function serverGetRiddlePools() {
  try {
    const { data } = await getAdminClient()
      .from('riddle_pools').select('pool_index,amount,fetched_at').order('pool_index');
    const pools = data || [];
    return {
      pool1: Number(pools.find((p: { pool_index: number }) => p.pool_index === 1)?.amount ?? 0),
      pool2: Number(pools.find((p: { pool_index: number }) => p.pool_index === 2)?.amount ?? 0),
      pool3: Number(pools.find((p: { pool_index: number }) => p.pool_index === 3)?.amount ?? 0),
      total: pools.reduce((s: number, p: { amount: number }) => s + Number(p.amount), 0),
      fetched_at: pools[0]?.fetched_at ?? null,
    };
  } catch { return { pool1: 0, pool2: 0, pool3: 0, total: 0, fetched_at: null }; }
}

export async function serverGetLockDist() {
  try {
    const { data } = await getAdminClient()
      .from('lock_distribution_cache').select('*').order('duration');
    return data ?? [];
  } catch { return []; }
}

export async function serverGetDrizzletDist() {
  try {
    const { data } = await getAdminClient()
      .from('drizzlet_distribution_cache').select('*').eq('id', 'main').single();
    return data ?? { locked_ika_rewards: 0, isui_rewards: 0, unlocked_drizzlets: 0, riddle_rewards: 0 };
  } catch { return { locked_ika_rewards: 0, isui_rewards: 0, unlocked_drizzlets: 0, riddle_rewards: 0 }; }
}
