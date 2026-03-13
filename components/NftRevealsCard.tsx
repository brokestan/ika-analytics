'use client';
import { ImageIcon } from 'lucide-react';
import { formatNumber } from '@/lib/calculations';
import type { NftStats } from '@/lib/serverSupabase';

interface Props {
  data:     NftStats | null;
  loading?: boolean;
}

export default function NftRevealsCard({ data, loading }: Props) {
  if (loading || !data) {
    return (
      <div className="card p-5">
        <div className="shimmer h-5 w-36 rounded mb-4" />
        <div className="space-y-3">
          {[0, 1, 2].map(i => <div key={i} className="shimmer h-14 rounded-xl" />)}
        </div>
      </div>
    );
  }

  const stats = [
    {
      label:   'NFTs Revealed',
      value:   data.total_reveals.toLocaleString(),
      sub:     'total Squid Maiden reveals',
      color:   'text-amber-400',
      bg:      'bg-amber-500/5 border-amber-500/15',
    },
    {
      label:   'Drizzlets Earned',
      value:   formatNumber(data.total_drizzlets, 0),
      sub:     'from NFT reveals',
      color:   'text-ika-pink',
      bg:      'bg-ika-pink/5 border-ika-pink/15',
    },
    {
      label:   'Avg per Reveal',
      value:   data.avg_per_reveal.toLocaleString(),
      sub:     'drizzlets per NFT',
      color:   'text-emerald-400',
      bg:      'bg-emerald-500/5 border-emerald-500/15',
    },
  ];

  return (
    <div className="card p-5 animate-slide-up" style={{ animationDelay: '220ms' }}>
      <div className="flex items-center gap-2 mb-4">
        <div className="w-7 h-7 rounded-lg bg-amber-500/20 flex items-center justify-center">
          <ImageIcon className="w-3.5 h-3.5 text-amber-400" />
        </div>
        <h3 className="font-display font-semibold text-sm text-white">NFT Reveals</h3>
      </div>

      <div className="space-y-2.5">
        {stats.map((s) => (
          <div
            key={s.label}
            className={`border rounded-xl px-4 py-3 flex items-center justify-between ${s.bg}`}
          >
            <div>
              <p className="text-xs text-ika-dim">{s.label}</p>
              <p className="text-[10px] text-ika-muted/70 mt-0.5">{s.sub}</p>
            </div>
            <p className={`font-mono font-bold text-lg leading-none ${s.color}`}>
              {s.value}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
