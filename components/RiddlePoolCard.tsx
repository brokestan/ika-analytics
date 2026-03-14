'use client';
import { Puzzle } from 'lucide-react';
import { formatNumber } from '@/lib/calculations';
import type { RiddleStats } from '@/lib/serverSupabase';

interface RiddlePoolData {
  pool1:      number;
  pool2:      number;
  pool3:      number;
  total:      number;
  fetched_at: string | null;
}

interface Props {
  data:        RiddlePoolData | null;
  stats:       RiddleStats | null;
  loading?:    boolean;
}

export default function RiddlePoolCard({ data, stats, loading }: Props) {
  if (loading || !data) {
    return (
      <div className="card p-5">
        <div className="shimmer h-5 w-40 rounded mb-4" />
        <div className="grid grid-cols-3 gap-3 mb-4">
          {[0, 1, 2].map(i => <div key={i} className="shimmer h-16 rounded-lg" />)}
        </div>
        <div className="space-y-2">
          {[0, 1, 2, 3].map(i => <div key={i} className="shimmer h-8 rounded-lg" />)}
        </div>
      </div>
    );
  }

  const pools = [
    { label: 'Riddle 1', value: data.pool1 },
    { label: 'Riddle 2', value: data.pool2 },
    { label: 'Riddle 3', value: data.pool3 },
  ];

  const riddleRows = [
    {
      label:   'Total Submissions',
      value:   stats?.total_submissions ?? 0,
      suffix:  '',
      color:   'text-white',
      hint:    null,
    },
    {
      label:   'Riddle 1 — Solved by',
      value:   stats?.r1_solvers ?? 0,
      suffix:  ' wallets',
      color:   'text-emerald-400',
      hint:    stats && stats.total_wallets > 0
        ? `${((stats.r1_solvers / stats.total_wallets) * 100).toFixed(1)}%`
        : null,
    },
    {
      label:   'Riddle 2 — Solved by',
      value:   stats?.r2_solvers ?? 0,
      suffix:  ' wallets',
      color:   'text-violet-400',
      hint:    stats && stats.total_wallets > 0
        ? `${((stats.r2_solvers / stats.total_wallets) * 100).toFixed(1)}%`
        : null,
    },
    {
      label:   'Riddle 3 — Solved by',
      value:   stats?.r3_solvers ?? 0,
      suffix:  ' wallets',
      color:   'text-amber-400',
      hint:    'unsolved',
    },
  ];

  return (
    <div className="card p-5 animate-slide-up" style={{ animationDelay: '200ms' }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-amber-500/20 flex items-center justify-center">
            <Puzzle className="w-3.5 h-3.5 text-amber-400" />
          </div>
          <h3 className="font-display font-semibold text-sm text-white">Riddle Pools</h3>
        </div>
        <div className="text-right">
          <p className="text-xs text-ika-dim">Total Prize</p>
          <p className="font-mono font-bold text-amber-400 text-base">{formatNumber(data.total, 2)} IKA</p>
        </div>
      </div>

      {/* Pool amounts */}
      <div className="grid grid-cols-3 gap-2 mb-4">
        {pools.map((pool, i) => (
          <div
            key={i}
            className="bg-amber-500/5 border border-amber-500/15 rounded-xl p-3 text-center hover:border-amber-500/30 transition-colors"
          >
            <p className="text-xs text-ika-dim mb-1">{pool.label}</p>
            <p className="font-mono font-bold text-white text-base leading-none">
              {formatNumber(pool.value, 1)}
            </p>
            <p className="text-xs text-ika-muted mt-0.5">IKA</p>
          </div>
        ))}
      </div>

      {/* Divider */}
      <div className="border-t border-ika-border/50 mb-4" />

      {/* Submission stats */}
      <div className="space-y-2">
        {riddleRows.map((row) => (
          <div
            key={row.label}
            className="flex items-center justify-between bg-white/[0.03] border border-white/5 rounded-lg px-3 py-2"
          >
            <span className="text-xs text-ika-dim">{row.label}</span>
            <div className="flex items-center gap-2">
              {row.hint && (
                <span className="text-[10px] text-ika-muted bg-white/5 px-1.5 py-0.5 rounded font-mono">
                  {row.hint}
                </span>
              )}
              <span className={`font-mono text-sm font-bold ${row.color}`}>
                {row.value.toLocaleString()}{row.suffix}
              </span>
            </div>
          </div>
        ))}
      </div>

    </div>
  );
}
