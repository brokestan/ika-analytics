'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { Search, Trophy, ChevronLeft, ChevronRight, X, Users, ArrowDownUp, ArrowUp, ArrowDown, Info } from 'lucide-react';
import LeaderboardTable from '@/components/LeaderboardTable';
import type { LeaderboardEntry } from '@/app/api/leaderboard/route';
import clsx from 'clsx';

const PER_PAGE = 30;

type SortBy  = 'total_drizzlets' | 'ika_locked';
type SortDir = 'desc' | 'asc';

export default function LeaderboardPage() {
  const [search,    setSearch]    = useState('');
  const [page,      setPage]      = useState(1);
  const [data,      setData]      = useState<LeaderboardEntry[]>([]);
  const [total,     setTotal]     = useState(0);      // filtered count (for pagination)
  const [totalAll,  setTotalAll]  = useState(0);
  const [totalDrz,  setTotalDrz]  = useState(0);      // all wallets (for header)
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState('');
  const [sortBy,    setSortBy]    = useState<SortBy>('total_drizzlets');
  const [sortDir,   setSortDir]   = useState<SortDir>('desc');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchData = useCallback(async (q: string, p: number, sb: SortBy, sd: SortDir) => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({
        page:     String(p),
        limit:    String(PER_PAGE),
        sort_by:  sb,
        sort_dir: sd,
      });
      if (q.length >= 4) params.set('search', q);

      const res  = await fetch(`/api/leaderboard?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json() as {
        data: LeaderboardEntry[];
        total: number;
        total_all: number;
        total_drizzlets_all: number;
        error?: string;
      };
      if (json.error) throw new Error(json.error);
      setData(json.data || []);
      setTotal(json.total || 0);
      setTotalAll(prev => json.total_all > 0 ? json.total_all : prev);
      setTotalDrz(prev => json.total_drizzlets_all > 0 ? json.total_drizzlets_all : prev); // never overwrite with 0
    } catch {
      setError('Failed to load leaderboard. Please try again.');
      setData([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => { fetchData('', 1, sortBy, sortDir); }, [fetchData]); // eslint-disable-line

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setPage(1);
      fetchData(search, 1, sortBy, sortDir);
    }, 350);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [search, sortBy, sortDir, fetchData]);

  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));
  const from       = (page - 1) * PER_PAGE;

  function handlePage(p: number) {
    if (p < 1 || p > totalPages || p === page) return;
    setPage(p);
    fetchData(search, p, sortBy, sortDir);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function handleSort(newSortBy: SortBy) {
    if (newSortBy === sortBy) {
      // Toggle direction
      const newDir: SortDir = sortDir === 'desc' ? 'asc' : 'desc';
      setSortDir(newDir);
      setPage(1);
      fetchData(search, 1, sortBy, newDir);
    } else {
      setSortBy(newSortBy);
      setSortDir('desc');
      setPage(1);
      fetchData(search, 1, newSortBy, 'desc');
    }
  }

  function getPageNums(): number[] {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
    if (page <= 4)       return [1, 2, 3, 4, 5];
    if (page >= totalPages - 3) return [totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
    return [page - 2, page - 1, page, page + 1, page + 2];
  }

  const [showInfo, setShowInfo] = useState(false);
  const SortIcon = ({ active, dir }: { active: boolean; dir: SortDir }) => {
    if (!active) return <ArrowDownUp className="w-3 h-3 text-ika-muted/50" />;
    return dir === 'desc'
      ? <ArrowDown className="w-3 h-3 text-ika-pink" />
      : <ArrowUp   className="w-3 h-3 text-ika-pink" />;
  };

  return (
    <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-6 space-y-6">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display font-bold text-2xl sm:text-3xl text-white tracking-tight flex items-center gap-2.5">
            <Trophy className="w-7 h-7 text-amber-400 flex-shrink-0" aria-hidden="true" />
            Leader<span className="text-ika-gradient">board</span>
          </h1>
          <p className="text-sm text-ika-dim mt-1">Top drizzlet earners across the IKA ecosystem</p>
        </div>

        {/* Total wallets badge — always shows full count, not search-filtered */}
        <div className="bg-white/5 border border-ika-border rounded-xl px-4 py-2.5 text-center flex-shrink-0">
          <div className="flex items-center gap-1.5">
            <Users className="w-4 h-4 text-ika-muted" aria-hidden="true" />
            <span className="font-mono font-bold text-white text-base leading-none">
              {(totalAll || 0).toLocaleString()}
            </span>
          </div>
          <p className="text-[10px] text-ika-muted mt-0.5 uppercase tracking-wider">Total Wallets</p>
        </div>
      </div>

      {/* ── Controls row: search + sort filters ────────────────────────────── */}
      <div className="flex flex-col sm:flex-row gap-3">

        {/* Search */}
        <div className="relative flex-1">
          <label htmlFor="wallet-search" className="sr-only">Search by wallet address</label>
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-ika-muted pointer-events-none" aria-hidden="true" />
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

        {/* Sort filters + info */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-xs text-ika-muted whitespace-nowrap">Sort by:</span>
          <button
            onClick={() => handleSort('total_drizzlets')}
            className={clsx(
              'flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-xs font-medium border transition-all',
              sortBy === 'total_drizzlets'
                ? 'bg-ika-pink/10 border-ika-pink/40 text-ika-pink'
                : 'bg-ika-card border-ika-border text-ika-dim hover:border-ika-pink/30 hover:text-ika-text'
            )}
          >
            Drizzlets
            <SortIcon active={sortBy === 'total_drizzlets'} dir={sortDir} />
          </button>
          <button
            onClick={() => handleSort('ika_locked')}
            className={clsx(
              'flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-xs font-medium border transition-all',
              sortBy === 'ika_locked'
                ? 'bg-ika-pink/10 border-ika-pink/40 text-ika-pink'
                : 'bg-ika-card border-ika-border text-ika-dim hover:border-ika-pink/30 hover:text-ika-text'
            )}
          >
            Staked IKA
            <SortIcon active={sortBy === 'ika_locked'} dir={sortDir} />
          </button>

          {/* Info button */}
          <div className="relative">
            <button
              onClick={() => setShowInfo(v => !v)}
              aria-label="Column info"
              className={clsx(
                'flex items-center justify-center w-8 h-8 rounded-lg border transition-all',
                showInfo
                  ? 'bg-ika-pink/10 border-ika-pink/40 text-ika-pink'
                  : 'bg-ika-card border-ika-border text-ika-muted hover:border-ika-pink/30 hover:text-ika-text'
              )}
            >
              <Info className="w-3.5 h-3.5" />
            </button>

            {showInfo && (
              <div className="absolute right-0 top-full mt-2 w-72 bg-ika-card border border-ika-border rounded-xl shadow-2xl p-4 z-50 animate-fade-in">
                <p className="text-xs font-semibold text-white mb-3 uppercase tracking-wider">Column Guide</p>
                <div className="space-y-2.5 text-[11px] text-ika-dim">
                  <div><span className="text-white font-medium">Drz from IKA</span> — Drizzlets earned from IKA locks (both active and unlocked positions combined)</div>
                  <div><span className="text-white font-medium">Drz from iSUI</span> — Drizzlets earned from iSUI locks (both active and unlocked positions combined)</div>
                  <div><span className="text-white font-medium">Riddle Drizzlets</span> — Drizzlets earned from riddle submissions (31 drz each, right or wrong). Uses on-chain data for full accuracy.</div>
                  <div><span className="text-white font-medium">NFTs Revealed</span> — Number of Squid Maiden NFTs revealed, with total drizzlets earned from reveals shown below</div>
                  <div><span className="text-white font-medium">Locked Drizzlets</span> — Drizzlets silently accumulating from positions that are still locked and have not been claimed yet</div>
                  <div><span className="text-white font-medium">Unlocked Drizzlets</span> — All realized drizzlets: from unlocked staking positions + NFT reveals + riddle submissions</div>
                  <div><span className="text-white font-medium">Total Drizzlets</span> — Locked + Unlocked combined. Your real drizzlet balance. The percentage shown below is your share of all drizzlets earned across the entire ecosystem.</div>
                </div>
                <button
                  onClick={() => setShowInfo(false)}
                  className="mt-3 text-[10px] text-ika-muted hover:text-ika-text transition-colors"
                >
                  Close
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Error ──────────────────────────────────────────────────────────── */}
      {error && (
        <p role="alert" className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 px-4 py-3 rounded-xl">
          {error}
        </p>
      )}

      {/* ── Search result count ─────────────────────────────────────────────── */}
      {search.length >= 4 && !loading && (
        <p className="text-sm text-ika-dim">
          {total === 0
            ? 'No wallets matched your search.'
            : <>Found <span className="text-white font-mono">{total}</span> matching wallet{total > 1 ? 's' : ''}</>
          }
        </p>
      )}

      {/* ── Table ──────────────────────────────────────────────────────────── */}
      <LeaderboardTable data={data} loading={loading} totalDrz={totalDrz} />

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
            <button
              onClick={() => handlePage(page - 1)}
              disabled={page <= 1}
              aria-label="Previous page"
              className="flex items-center gap-1 px-3 py-2 rounded-lg text-sm border border-ika-border text-ika-dim hover:border-ika-pink/40 hover:text-ika-text disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            >
              <ChevronLeft className="w-4 h-4" />
              <span className="hidden sm:inline">Prev</span>
            </button>

            {!getPageNums().includes(1) && (
              <>
                <button onClick={() => handlePage(1)} className="w-9 h-9 rounded-lg text-sm font-mono border border-ika-border text-ika-dim hover:border-ika-pink/40 transition-all">1</button>
                <span className="text-ika-muted px-1">…</span>
              </>
            )}

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

            {!getPageNums().includes(totalPages) && (
              <>
                <span className="text-ika-muted px-1">…</span>
                <button onClick={() => handlePage(totalPages)} className="w-9 h-9 rounded-lg text-sm font-mono border border-ika-border text-ika-dim hover:border-ika-pink/40 transition-all">{totalPages}</button>
              </>
            )}

            <button
              onClick={() => handlePage(page + 1)}
              disabled={page >= totalPages}
              aria-label="Next page"
              className="flex items-center gap-1 px-3 py-2 rounded-lg text-sm border border-ika-border text-ika-dim hover:border-ika-pink/40 hover:text-ika-text disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            >
              <span className="hidden sm:inline">Next</span>
              <ChevronRight className="w-4 h-4" />
            </button>

            {/* ── Go to page — desktop only inline ─────────────────── */}
            <div className="hidden sm:flex items-center gap-1.5 ml-1">
              <span className="text-xs text-ika-muted">Go to</span>
              <input
                type="number"
                min={1}
                max={totalPages}
                placeholder={String(page)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const val = parseInt((e.target as HTMLInputElement).value, 10);
                    if (!isNaN(val)) {
                      handlePage(val);
                      (e.target as HTMLInputElement).value = '';
                    }
                  }
                }}
                className="w-14 bg-ika-card border border-ika-border rounded-lg px-2 py-1.5 text-xs text-center font-mono text-ika-text placeholder-ika-muted/50 focus:outline-none focus:border-ika-pink/60 focus:ring-1 focus:ring-ika-pink/30 transition-all [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
            </div>

          </div>

          {/* ── Go to page — mobile full width ───────────────────────── */}
          <div className="flex sm:hidden items-center justify-center gap-2 mt-3">
            <span className="text-xs text-ika-muted">Jump to page</span>
            <input
              type="number"
              min={1}
              max={totalPages}
              placeholder={String(page)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const val = parseInt((e.target as HTMLInputElement).value, 10);
                  if (!isNaN(val)) {
                    handlePage(val);
                    (e.target as HTMLInputElement).value = '';
                  }
                }
              }}
              className="w-20 bg-ika-card border border-ika-border rounded-lg px-3 py-2 text-sm text-center font-mono text-ika-text placeholder-ika-muted/50 focus:outline-none focus:border-ika-pink/60 focus:ring-1 focus:ring-ika-pink/30 transition-all [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
            <span className="text-xs text-ika-muted">of {totalPages}</span>
          </div>

        </nav>
      )}
    </div>
  );
}
