import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const revalidate = 600;

const RIDDLE_POOL_OBJECT =
  process.env.RIDDLE_POOL_OBJECT_ID ||
  '0x92c105c5cf5713a751ee18e7a007fbb238ae242b7234cf1ee25be51974eef334';
const RPC_URL = process.env.SUI_RPC_URL || 'https://fullnode.mainnet.sui.io:443';

export async function GET() {
  try {
    const db = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false } }
    );

    const rpcRes = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'sui_getObject',
        params: [RIDDLE_POOL_OBJECT, { showContent: true }],
      }),
    });

    if (rpcRes.ok) {
      const json = await rpcRes.json() as { result?: { data?: { content?: { fields?: Record<string, unknown> } } } };
      const fields = json.result?.data?.content?.fields;
      if (fields) {
        const toHuman = (v: unknown) => Number(String(v || '0')) / 1e9;
        const p1 = toHuman(fields.pool_1 ?? fields.pool1 ?? 0);
        const p2 = toHuman(fields.pool_2 ?? fields.pool2 ?? 0);
        const p3 = toHuman(fields.pool_3 ?? fields.pool3 ?? 0);
        const now = new Date().toISOString();
        await Promise.all([
          db.from('riddle_pools').upsert({ pool_index: 1, amount: p1, raw_amount: String(fields.pool_1 ?? 0), fetched_at: now }, { onConflict: 'pool_index' }),
          db.from('riddle_pools').upsert({ pool_index: 2, amount: p2, raw_amount: String(fields.pool_2 ?? 0), fetched_at: now }, { onConflict: 'pool_index' }),
          db.from('riddle_pools').upsert({ pool_index: 3, amount: p3, raw_amount: String(fields.pool_3 ?? 0), fetched_at: now }, { onConflict: 'pool_index' }),
        ]);
        return NextResponse.json({ data: { pool1: p1, pool2: p2, pool3: p3, total: p1 + p2 + p3, fetched_at: now }, error: null });
      }
    }

    const { data } = await db.from('riddle_pools').select('*').order('pool_index');
    const pools = data || [];
    const pool1 = Number(pools.find((p: { pool_index: number }) => p.pool_index === 1)?.amount ?? 0);
    const pool2 = Number(pools.find((p: { pool_index: number }) => p.pool_index === 2)?.amount ?? 0);
    const pool3 = Number(pools.find((p: { pool_index: number }) => p.pool_index === 3)?.amount ?? 0);
    return NextResponse.json({ data: { pool1, pool2, pool3, total: pool1 + pool2 + pool3, fetched_at: pools[0]?.fetched_at ?? null }, error: null });
  } catch (err) {
    console.error('[/api/riddle-pool]', err instanceof Error ? err.message : 'unknown');
    return NextResponse.json({ data: null, error: 'Failed to fetch riddle pool' }, { status: 500 });
  }
}
