import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getDrizzletRate } from '@/lib/sui-rpc';
import { LockDuration } from '@/lib/types';

export const revalidate = 60;

// ── Helpers ───────────────────────────────────────────────────────────────────

function sanitizeSearch(raw: string): string {
  return raw.replace(/[^0-9a-fA-Fx]/g, '').slice(0, 66);
}

function clampInt(val: string, min: number, max: number, fallback: number): number {
  const n = parseInt(val, 10);
  if (isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function calcIkaDrz(ika: number, days: number, rate: number): number {
  return Math.floor((ika / 10) * rate * Math.max(0, days));
}

function calcISUIDrz(isui: number, days: number): number {
  return isui * Math.max(0, Math.floor(days));
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface LeaderboardEntry {
  rank:               number;
  wallet_address:     string;
  ika_locked:         number;
  isui_locked:        number;
  active_locks:       number;
  drz_from_ika:       number;   // locked IKA drz + unlocked IKA drz
  drz_from_isui:      number;   // locked iSUI drz + unlocked iSUI drz
  locked_drizzlets:   number;   // drizzlets from still-active locks (IKA + iSUI)
  unlocked_drizzlets: number;   // drizzlets from completed/unlocked positions
  drz_riddle:         number;   // riddle drizzlets (chain_drizzlets authoritative for gap wallets)
  drz_nft:            number;   // drizzlets from NFT reveals
  nfts_revealed:      number;   // count of NFT reveal events
  riddle_one_solved:  boolean;
  riddle_two_solved:  boolean;
  riddle_three_solved:boolean;
  community_code_used:boolean;
  total_drizzlets:    number;   // computed sum of all sources
}

// ── Route ─────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const page      = clampInt(searchParams.get('page')  || '1',  1, 500,  1);
  const perPage   = clampInt(searchParams.get('limit') || '30', 1, 100, 30);
  const rawSearch = searchParams.get('search') || '';
  const search    = sanitizeSearch(rawSearch);
  const sortBy    = searchParams.get('sort_by') === 'ika_locked' ? 'ika_locked' : 'total_drizzlets';
  const sortAsc   = searchParams.get('sort_dir') === 'asc';

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ data: [], total: 0, total_all: 0, page, per_page: perPage, error: null });
  }

  try {
    const db = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false } }
    );

    // ── 1. Total wallet count (always unfiltered, for header display) ─────────
    const { count: totalAll } = await db
      .from('wallets')
      .select('address', { count: 'exact', head: true });

    // ── 2. Paginated wallet rows ───────────────────────────────────────────────
    let walletQuery = db
      .from('wallets')
      .select('address, ika_locked, isui_locked, active_locks, total_drizzlets', { count: 'exact' })
      .order(sortBy, { ascending: sortAsc });

    if (search.length >= 4) {
      walletQuery = walletQuery.ilike('address', `%${search}%`);
    }

    const from = (page - 1) * perPage;
    const to   = from + perPage - 1;
    walletQuery = walletQuery.range(from, to);

    const { data: walletRows, error: walletErr, count: filteredCount } = await walletQuery;
    if (walletErr) throw walletErr;
    if (!walletRows || walletRows.length === 0) {
      return NextResponse.json({ data: [], total: 0, total_all: totalAll || 0, page, per_page: perPage, error: null });
    }

    const addresses = walletRows.map((w: { address: string }) => w.address);

    // ── 3. Drizzlets breakdown for this page ──────────────────────────────────
    const { data: drizzRows } = await db
      .from('drizzlets')
      .select('wallet_address, source, amount')
      .in('wallet_address', addresses);

    // ── 4. Active locks for locked drizzlet calculation ───────────────────────
    const { data: lockRows } = await db
      .from('locks')
      .select('wallet_address, asset_type, lock_duration, ika_amount, isui_amount, locked_at')
      .in('wallet_address', addresses)
      .eq('is_active', true);

    // ── 5. UserTasks data (riddle solved, community code, chain drizzlets) ────
    const { data: taskRows } = await db
      .from('wallet_user_tasks')
      .select('wallet_address, riddle_one_solved, riddle_two_solved, riddle_three_solved, community_code, chain_drizzlets')
      .in('wallet_address', addresses);

    // ── 6. Compute per-wallet drizzlet breakdown ──────────────────────────────
    const now = Date.now();

    // Aggregate historical drizzlets by source
    type DrzMap = { unlock: number; isui_lock: number; riddle: number; nft_reveal: number; nft_count: number };
    const drzByWallet: Record<string, DrzMap> = {};
    for (const r of (drizzRows || [])) {
      const addr = r.wallet_address;
      if (!drzByWallet[addr]) drzByWallet[addr] = { unlock: 0, isui_lock: 0, riddle: 0, nft_reveal: 0, nft_count: 0 };
      const amt = Number(r.amount);
      if      (r.source === 'unlock')     drzByWallet[addr].unlock     += amt;
      else if (r.source === 'isui_lock')  drzByWallet[addr].isui_lock  += amt;
      else if (r.source === 'riddle')     drzByWallet[addr].riddle     += amt;
      else if (r.source === 'nft_reveal') {
        drzByWallet[addr].nft_reveal += amt;
        drzByWallet[addr].nft_count  += 1;
      }
    }

    // Compute locked drizzlets from active locks
    type LockedMap = { ika: number; isui: number };
    const lockedByWallet: Record<string, LockedMap> = {};
    for (const lock of (lockRows || [])) {
      const addr = lock.wallet_address;
      if (!lockedByWallet[addr]) lockedByWallet[addr] = { ika: 0, isui: 0 };
      const days = Math.floor((now - new Date(lock.locked_at).getTime()) / 86400000);
      if (lock.asset_type === 'isui') {
        lockedByWallet[addr].isui += calcISUIDrz(Number(lock.isui_amount), days);
      } else {
        const rate = getDrizzletRate(Number(lock.lock_duration) as LockDuration);
        lockedByWallet[addr].ika += calcIkaDrz(Number(lock.ika_amount), days, rate);
      }
    }

    // Index task rows
    const taskByWallet: Record<string, {
      riddle_one_solved: boolean;
      riddle_two_solved: boolean;
      riddle_three_solved: boolean;
      community_code: string | null;
      chain_drizzlets: number;
    }> = {};
    for (const t of (taskRows || [])) {
      taskByWallet[t.wallet_address] = {
        riddle_one_solved:   !!t.riddle_one_solved,
        riddle_two_solved:   !!t.riddle_two_solved,
        riddle_three_solved: !!t.riddle_three_solved,
        community_code:      t.community_code || null,
        chain_drizzlets:     Number(t.chain_drizzlets || 0),
      };
    }

    // ── 7. Compute actual ranks for search results ────────────────────────────
    // When searching, pagination rank is wrong — get true rank per result wallet
    const rankOverrides: Record<string, number> = {};
    if (search.length >= 4) {
      for (const w of walletRows) {
        const { count: above } = await db
          .from('wallets')
          .select('address', { count: 'exact', head: true })
          .gt(sortBy, w[sortBy as 'total_drizzlets' | 'ika_locked']);
        rankOverrides[w.address] = (above || 0) + 1;
      }
    }

    // ── 8. Build entries ──────────────────────────────────────────────────────
    const entries: LeaderboardEntry[] = walletRows.map((w: {
      address: string;
      ika_locked: number;
      isui_locked: number;
      active_locks: number;
      total_drizzlets: number;
    }, i: number) => {
      const addr     = w.address;
      const drz      = drzByWallet[addr]   || { unlock: 0, isui_lock: 0, riddle: 0, nft_reveal: 0, nft_count: 0 };
      const locked   = lockedByWallet[addr] || { ika: 0, isui: 0 };
      const task     = taskByWallet[addr];

      // Riddle drizzlets: use chain_drizzlets (covers gap wallets) if higher than DB sum
      const drzRiddle = task
        ? Math.max(task.chain_drizzlets, drz.riddle)
        : drz.riddle;

      const lockedTotal   = locked.ika + locked.isui;
      const unlockedTotal = drz.unlock + drz.isui_lock;
      const drzFromIka    = locked.ika  + drz.unlock;
      const drzFromIsui   = locked.isui + drz.isui_lock;
      const drzNft        = drz.nft_reveal;
      const total         = lockedTotal + unlockedTotal + drzRiddle + drzNft;

      const baseRank = from + i + 1;
      const rank     = rankOverrides[addr] ?? baseRank;

      return {
        rank,
        wallet_address:      addr,
        ika_locked:          Number(w.ika_locked),
        isui_locked:         Number(w.isui_locked),
        active_locks:        Number(w.active_locks),
        drz_from_ika:        drzFromIka,
        drz_from_isui:       drzFromIsui,
        locked_drizzlets:    lockedTotal,
        unlocked_drizzlets:  unlockedTotal,
        drz_riddle:          drzRiddle,
        drz_nft:             drzNft,
        nfts_revealed:       drz.nft_count,
        riddle_one_solved:   task?.riddle_one_solved   ?? false,
        riddle_two_solved:   task?.riddle_two_solved   ?? false,
        riddle_three_solved: task?.riddle_three_solved ?? false,
        community_code_used: !!(task?.community_code),
        total_drizzlets:     total,
      };
    });

    return NextResponse.json({
      data:      entries,
      total:     filteredCount || 0,
      total_all: totalAll      || 0,
      page,
      per_page:  perPage,
      error:     null,
    });

  } catch (err) {
    console.error('[/api/leaderboard]', err instanceof Error ? err.message : 'unknown');
    return NextResponse.json(
      { data: [], total: 0, total_all: 0, page, per_page: perPage, error: 'Failed to load leaderboard' },
      { status: 500 }
    );
  }
}
