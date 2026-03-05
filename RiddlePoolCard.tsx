'use client';
import { Puzzle } from 'lucide-react';
import { formatNumber } from '@/lib/calculations';

interface RiddlePoolData {
  pool1: number;
  pool2: number;
  pool3: number;
  total: number;
  fetched_at: string | null;
}

interface Props {
  data: RiddlePoolData | null;
  loading?: boolean;
}

export default function RiddlePoolCard({ data, loading }: Props) {
  if (loading || !data) {
    return (
      <div className="card p-5">
        <div className="shimmer h-5 w-40 rounded mb-4" />
        <div className="grid grid-cols-3 gap-3">
          {[0,1,2].map(i => (
            <div key={i} className="shimmer h-16 rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  const pools = [
    { label: 'Riddle Pool 1', value: data.pool1 },
    { label: 'Riddle Pool 2', value: data.pool2 },
    { label: 'Riddle Pool 3', value: data.pool3 },
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
          <p className="text-xs text-ika-dim">Total</p>
          <p className="font-mono font-bold text-amber-400 text-base">{formatNumber(data.total, 2)}</p>
        </div>
      </div>

      {/* Pools grid */}
      <div className="grid grid-cols-3 gap-2">
        {pools.map((pool, i) => (
          <div
            key={i}
            className="bg-amber-500/5 border border-amber-500/15 rounded-xl p-3 text-center hover:border-amber-500/30 transition-colors"
          >
            <p className="text-xs text-ika-dim mb-1 truncate">{pool.label}</p>
            <p className="font-mono font-bold text-white text-base leading-none">
              {formatNumber(pool.value, 1)}
            </p>
            <p className="text-xs text-ika-muted mt-0.5">IKA</p>
          </div>
        ))}
      </div>

      {data.fetched_at && (
        <p className="text-xs text-ika-muted text-right mt-3">
          Updated {new Date(data.fetched_at).toLocaleTimeString()}
        </p>
      )}
    </div>
  );
}
