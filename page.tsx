'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { Search, Trophy, ChevronLeft, ChevronRight, X, Users } from 'lucide-react';
import LeaderboardTable from '@/components/LeaderboardTable';
import clsx from 'clsx';

const PER_PAGE = 30;

interface LeaderboardEntry {
  rank:            number;
  wallet_address:  string;
  ika_locked:      number;
  isui_locked:     number;
  active_locks:    number;
  total_drizzlets: number;
}

export default function LeaderboardPage() {
  const [search,   setSearch]   = useState('');
  const [page,     setPage]     = useState(1);
  const [data,     setData]     = useState<LeaderboardEntry[]>([]);
  const [total,    setTotal]    = useState(0);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchData = useCallback(async (q: string, p: number) => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ page: String(p), limit: String(PER_PAGE) });
      if (q.length >= 4) params.set('search', q);
      const res  = await fetch(`/api/leaderboard?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json() as { data: LeaderboardEntry[]; total: number; error?: string };
      if (json.error) throw new Error(json.error);
      setData(json.data || []);
      setTotal(json.total || 0);
    } catch (e) {
      setError('Failed to load leaderboard. Please try again.');
      setData([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => { fetchData('', 1); }, [fetchData]);

  // Debounced search — 350ms
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setPage(1);
      fetchData(search, 1);
    }, 350);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [search, fetchData]);

  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));
  const from = (page - 1) * PER_PAGE;

  function handlePage(p: number) {
    if (p < 1 || p > totalPages || p === page) return;
    setPage(p);
    fetchData(search, p);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // Page numbers to display
  function getPageNums(): number[] {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
    if (page <= 4)        return [1, 2, 3, 4, 5];
    if (page >= totalPages - 3) return [totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
    return [page - 2, page - 1, page, page + 1, page + 2];
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display font-bold text-2xl sm:text-3xl text-white tracking-tight flex items-center gap-2.5">
            <Trophy className="w-7 h-7 text-amber-400 flex-shrink-0" aria-hidden="true" />
            Leader<span className="text-ika-gradient">board</span>
          </h1>
          <p className="text-sm text-ika-dim mt-1">Top drizzlet earners across the IKA ecosystem</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="bg-white/5 border border-ika-border rounded-xl px-4 py-2.5 text-center">
            <div className="flex items-center gap-1.5">
              <Users className="w-4 h-4 text-ika-muted" aria-hidden="true" />
              <span className="font-mono font-bold text-white text-base leading-none">
                {total.toLocaleString()}
              </span>
            </div>
            <p className="text-[10px] text-ika-muted mt-0.5 uppercase tracking-wider">Wallets</p>
          </div>
        </div>
      </div>

      {/* ── Search ─────────────────────────────────────────────────────────── */}
      <div className="relative">
        <label htmlFor="wallet-search" className="sr-only">Search by wallet address</label>
        <Search
          className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-ika-muted pointer-events-none"
          aria-hidden="true"
        />
        <input
          id="wallet-search"
          type="search"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by wallet address (min. 4 characters)…"
          autoComplete="off"
          spellCheck={false}
          className="w-full bg-ika-card border border-ika-border rounded-xl pl-10 pr-10 py-3 text-sm text-ika-text placeholder-ika-muted/60 focus:outline-none focus:border-ika-pink/60 focus:ring-1 focus:ring-ika-pink/30 transition-all font-mono"
        />
        {search && (
          <button
            onClick={() => setSearch('')}
            aria-label="Clear search"
            className="absolute right-3.5 top-1/2 -translate-y-1/2 text-ika-muted hover:text-ika-text transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* ── Error ──────────────────────────────────────────────────────────── */}
      {error && (
        <p role="alert" className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 px-4 py-3 rounded-xl">
          {error}
        </p>
      )}

      {/* ── Table ──────────────────────────────────────────────────────────── */}
      <LeaderboardTable data={data} loading={loading} />

      {/* ── Pagination ─────────────────────────────────────────────────────── */}
      {totalPages > 1 && !loading && (
        <nav aria-label="Leaderboard pagination" className="flex items-center justify-between flex-wrap gap-3">
          <p className="text-sm text-ika-dim">
            Showing{' '}
            <span className="text-white font-mono">{from + 1}–{Math.min(from + PER_PAGE, total)}</span>
            {' '}of{' '}
            <span className="text-white font-mono">{total.toLocaleString()}</span>
          </p>

          <div className="flex items-center gap-1">
            {/* Prev */}
            <button
              onClick={() => handlePage(page - 1)}
              disabled={page <= 1}
              aria-label="Previous page"
              className="flex items-center gap-1 px-3 py-2 rounded-lg text-sm border border-ika-border text-ika-dim hover:border-ika-pink/40 hover:text-ika-text disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            >
              <ChevronLeft className="w-4 h-4" />
              <span className="hidden sm:inline">Prev</span>
            </button>

            {/* First page + ellipsis */}
            {!getPageNums().includes(1) && (
              <>
                <button onClick={() => handlePage(1)} className="w-9 h-9 rounded-lg text-sm font-mono border border-ika-border text-ika-dim hover:border-ika-pink/40 transition-all">1</button>
                <span className="text-ika-muted px-1">…</span>
              </>
            )}

            {/* Page numbers */}
            {getPageNums().map(p => (
              <button
                key={p}
                onClick={() => handlePage(p)}
                aria-label={`Page ${p}`}
                aria-current={p === page ? 'page' : undefined}
                className={clsx(
                  'w-9 h-9 rounded-lg text-sm font-mono font-medium transition-all',
                  p === page
                    ? 'bg-ika-pink text-white shadow-ika-sm border border-transparent'
                    : 'border border-ika-border text-ika-dim hover:border-ika-pink/40 hover:text-ika-text'
                )}
              >
                {p}
              </button>
            ))}

            {/* Last page + ellipsis */}
            {!getPageNums().includes(totalPages) && (
              <>
                <span className="text-ika-muted px-1">…</span>
                <button onClick={() => handlePage(totalPages)} className="w-9 h-9 rounded-lg text-sm font-mono border border-ika-border text-ika-dim hover:border-ika-pink/40 transition-all">{totalPages}</button>
              </>
            )}

            {/* Next */}
            <button
              onClick={() => handlePage(page + 1)}
              disabled={page >= totalPages}
              aria-label="Next page"
              className="flex items-center gap-1 px-3 py-2 rounded-lg text-sm border border-ika-border text-ika-dim hover:border-ika-pink/40 hover:text-ika-text disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            >
              <span className="hidden sm:inline">Next</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </nav>
      )}

    </div>
  );
}
