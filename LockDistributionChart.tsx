'use client';
import { Lock, TrendingUp } from 'lucide-react';
import { formatNumber } from '@/lib/calculations';
import clsx from 'clsx';

interface LockItem {
  duration: number;
  label: string;
  percentage: number;
  total_nfts: number;
  total_ika: number;
  rate: number;
}

interface Props {
  data: LockItem[];
  loading?: boolean;
}

const COLORS: Record<number, { bar: string; badge: string; text: string }> = {
  0:  { bar: 'bg-ika-pink',    badge: 'bg-ika-pink/15 text-ika-pink',       text: 'text-ika-pink' },
  1:  { bar: 'bg-cyan-500',    badge: 'bg-cyan-500/15 text-cyan-400',        text: 'text-cyan-400' },
  7:  { bar: 'bg-violet-500',  badge: 'bg-violet-500/15 text-violet-400',    text: 'text-violet-400' },
  30: { bar: 'bg-emerald-500', badge: 'bg-emerald-500/15 text-emerald-400',  text: 'text-emerald-400' },
};

export default function LockDistributionChart({ data, loading }: Props) {
  if (loading) {
    return (
      <div className="card p-5">
        <div className="shimmer h-5 w-40 rounded mb-4" />
        <div className="space-y-3">
          {[0,1,2,3].map(i => <div key={i} className="shimmer h-20 rounded-xl" />)}
        </div>
      </div>
    );
  }

  const hasData = data.some(d => d.total_nfts > 0);

  return (
    <div className="card p-5 animate-slide-up" style={{ animationDelay: '150ms' }}>
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <div className="w-7 h-7 rounded-lg bg-ika-pink/20 flex items-center justify-center">
          <Lock className="w-3.5 h-3.5 text-ika-pink" />
        </div>
        <h3 className="font-display font-semibold text-sm text-white">Lock Distribution</h3>
      </div>

      {!hasData ? (
        <div className="flex flex-col items-center justify-center py-10 text-ika-muted">
          <Lock className="w-10 h-10 mb-3 opacity-30" />
          <p className="text-sm">No lock data yet</p>
          <p className="text-xs mt-1">Run the indexer to populate</p>
        </div>
      ) : (
        <div className="space-y-3">
          {data.map((item) => {
            const colors = COLORS[item.duration] || COLORS[30];
            return (
              <div
                key={item.duration}
                className="bg-white/3 border border-white/5 rounded-xl p-3 hover:border-white/10 transition-colors"
              >
                {/* Top row */}
                <div className="flex items-center justify-between mb-2">
                  <span className={clsx('text-sm font-semibold', colors.text)}>{item.label}</span>
                  <div className="flex items-center gap-1.5">
                    <TrendingUp className="w-3 h-3 text-ika-muted" />
                    <span className="text-xs text-ika-dim font-mono">{item.rate}x/10 IKA/day</span>
                  </div>
                </div>

                {/* Progress bar */}
                <div className="h-1.5 bg-white/5 rounded-full overflow-hidden mb-2">
                  <div
                    className={clsx('h-full rounded-full transition-all duration-700', colors.bar)}
                    style={{ width: `${item.percentage}%` }}
                  />
                </div>

                {/* Stats row */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className={clsx('text-xs font-mono font-bold px-2 py-0.5 rounded-full', colors.badge)}>
                      {item.percentage}%
                    </span>
                    <span className="text-xs text-ika-dim">{item.total_nfts.toLocaleString()} NFTs</span>
                  </div>
                  <span className="text-xs font-mono text-white">{formatNumber(item.total_ika, 2)} IKA</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
