import { NextResponse } from 'next/server';
import { fetchRiddlePool, toHumanIka } from '@/lib/sui-rpc';
import { supabaseAdmin } from '@/lib/supabase';

export const revalidate = 600; // 10 min

export async function GET() {
  try {
    // Try fresh chain fetch
    const raw = await fetchRiddlePool();

    if (raw) {
      const p1 = toHumanIka(raw.pool1);
      const p2 = toHumanIka(raw.pool2);
      const p3 = toHumanIka(raw.pool3);

      // Persist to DB
      await Promise.all([
        supabaseAdmin.from('riddle_pools').upsert({ pool_index: 1, amount: p1, raw_amount: raw.pool1, fetched_at: new Date().toISOString() }, { onConflict: 'pool_index' }),
        supabaseAdmin.from('riddle_pools').upsert({ pool_index: 2, amount: p2, raw_amount: raw.pool2, fetched_at: new Date().toISOString() }, { onConflict: 'pool_index' }),
        supabaseAdmin.from('riddle_pools').upsert({ pool_index: 3, amount: p3, raw_amount: raw.pool3, fetched_at: new Date().toISOString() }, { onConflict: 'pool_index' }),
      ]);

      return NextResponse.json({
        data: { pool1: p1, pool2: p2, pool3: p3, total: p1 + p2 + p3, fetched_at: new Date().toISOString() },
        error: null,
      });
    }

    // Fallback to DB cache
    const { data } = await supabaseAdmin.from('riddle_pools').select('*').order('pool_index');
    const pools = data || [];
    const pool1 = Number(pools.find((p: { pool_index: number }) => p.pool_index === 1)?.amount ?? 0);
    const pool2 = Number(pools.find((p: { pool_index: number }) => p.pool_index === 2)?.amount ?? 0);
    const pool3 = Number(pools.find((p: { pool_index: number }) => p.pool_index === 3)?.amount ?? 0);

    return NextResponse.json({
      data: { pool1, pool2, pool3, total: pool1 + pool2 + pool3, fetched_at: pools[0]?.fetched_at ?? null },
      error: null,
    });
  } catch (err) {
    console.error('[/api/riddle-pool]', err);
    return NextResponse.json({ data: null, error: 'Failed to fetch riddle pool' }, { status: 500 });
  }
}
