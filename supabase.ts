import { createClient } from '@supabase/supabase-js';

const supabaseUrl  = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabaseService = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Public client (for frontend / reads)
export const supabase = createClient(supabaseUrl, supabaseAnon, {
  auth: { persistSession: false },
});

// Admin client (for indexer writes) — server-side only
export const supabaseAdmin = supabaseService
  ? createClient(supabaseUrl, supabaseService, {
      auth: { persistSession: false },
    })
  : supabase;

// ─── Typed Query Helpers ──────────────────────────────────────────────────────

export async function getDashboardMetrics() {
  const { data, error } = await supabase
    .from('dashboard_cache')
    .select('*')
    .eq('id', 'main')
    .single();
  if (error) return null;
  return data;
}

export async function getRiddlePool() {
  const { data, error } = await supabase
    .from('riddle_pools')
    .select('*')
    .order('pool_index', { ascending: true });
  if (error) return [];
  return data;
}

export async function getLockDistribution() {
  const { data, error } = await supabase
    .from('lock_distribution_cache')
    .select('*')
    .order('duration', { ascending: true });
  if (error) return [];
  return data;
}

export async function getDrizzletDistribution() {
  const { data, error } = await supabase
    .from('drizzlet_distribution_cache')
    .select('*')
    .eq('id', 'main')
    .single();
  if (error) return null;
  return data;
}

export async function getLeaderboard(page = 1, perPage = 30, search = '') {
  let query = supabase
    .from('wallets')
    .select('address, ika_locked, isui_locked, active_locks, total_drizzlets', { count: 'exact' })
    .order('total_drizzlets', { ascending: false });

  if (search) {
    query = query.ilike('address', `%${search}%`);
  }

  const from = (page - 1) * perPage;
  const to   = from + perPage - 1;
  query = query.range(from, to);

  const { data, error, count } = await query;
  if (error) return { data: [], total: 0 };
  return { data: data || [], total: count || 0 };
}
