import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const revalidate = 300;

export async function GET() {
  try {
    const db = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false } }
    );

    const [dashRes, ridRes, lockDistRes, drizzDistRes] = await Promise.all([
      db.from('dashboard_cache').select('*').eq('id', 'main').single(),
      db.from('riddle_pools').select('*').order('pool_index'),
      db.from('lock_distribution_cache').select('*').order('duration'),
      db.from('drizzlet_distribution_cache').select('*').eq('id', 'main').single(),
    ]);

    const metrics = dashRes.data ?? {
      total_ika_staked: 0, total_isui_staked: 0, total_locked_nfts: 0,
      total_unlocked_nfts: 0, total_staking_nfts: 0, unique_staking_wallets: 0,
      total_drizzlets_earned: 0, forecast_drizzlets_30d: 0,
      forecast_drizzlets_60d: 0, forecast_drizzlets_season: 0, last_indexed_at: null,
    };

    const riddlePools = ridRes.data ?? [];
    const riddle = {
      pool1: Number(riddlePools.find((p: { pool_index: number }) => p.pool_index === 1)?.amount ?? 0),
      pool2: Number(riddlePools.find((p: { pool_index: number }) => p.pool_index === 2)?.amount ?? 0),
      pool3: Number(riddlePools.find((p: { pool_index: number }) => p.pool_index === 3)?.amount ?? 0),
      total: riddlePools.reduce((s: number, p: { amount: number }) => s + Number(p.amount), 0),
      fetched_at: riddlePools[0]?.fetched_at ?? null,
    };

    return NextResponse.json({
      data: {
        metrics,
        riddle,
        lockDist: lockDistRes.data ?? [],
        drizzDist: drizzDistRes.data ?? { locked_ika_rewards: 0, isui_rewards: 0, unlocked_drizzlets: 0, riddle_rewards: 0 },
      },
      error: null,
    });
  } catch (err) {
    console.error('[/api/dashboard]', err instanceof Error ? err.message : 'unknown');
    return NextResponse.json({ data: null, error: 'Failed to load dashboard' }, { status: 500 });
  }
}
