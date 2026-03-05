import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const revalidate = 300;

function sanitizeSearch(raw: string): string {
  return raw.replace(/[^0-9a-fA-Fx]/g, '').slice(0, 66);
}

function clampInt(val: string, min: number, max: number, fallback: number): number {
  const n = parseInt(val, 10);
  if (isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const page    = clampInt(searchParams.get('page')  || '1',  1, 100, 1);
  const perPage = clampInt(searchParams.get('limit') || '30', 1, 100, 30);
  const search  = sanitizeSearch(searchParams.get('search') || '');

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ data: [], total: 0, page, per_page: perPage, error: null });
  }

  try {
    const db = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false } }
    );

    let query = db
      .from('wallets')
      .select('address, ika_locked, isui_locked, active_locks, total_drizzlets', { count: 'exact' })
      .order('total_drizzlets', { ascending: false });

    if (search.length >= 4) query = query.ilike('address', `%${search}%`);

    const from = (page - 1) * perPage;
    query = query.range(from, from + perPage - 1);

    const { data, error, count } = await query;
    if (error) throw error;

    const entries = (data || []).map((w, i) => ({
      rank:            from + i + 1,
      wallet_address:  w.address as string,
      ika_locked:      Number(w.ika_locked),
      isui_locked:     Number(w.isui_locked),
      active_locks:    Number(w.active_locks),
      total_drizzlets: Number(w.total_drizzlets),
    }));

    return NextResponse.json({ data: entries, total: count || 0, page, per_page: perPage, error: null });
  } catch (err) {
    console.error('[/api/leaderboard]', err instanceof Error ? err.message : 'unknown');
    return NextResponse.json({ data: [], total: 0, page, per_page: perPage, error: 'Failed to load leaderboard' }, { status: 500 });
  }
}
