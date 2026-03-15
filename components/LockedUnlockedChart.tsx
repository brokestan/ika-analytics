'use client';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { Lock } from 'lucide-react';

interface DrizzletBreakdown {
  locked_ika:    number;
  unlocked_ika:  number;
  locked_isui:   number;
  unlocked_isui: number;
  nft_reveals:   number;
  riddle_sub:    number;
  riddle_pools:  number;
}

interface Props {
  data:     DrizzletBreakdown | null;
  loading?: boolean;
}

function fmtPct(pct: number): string {
  if (pct >= 1)    return pct.toFixed(1) + '%';
  if (pct >= 0.1)  return pct.toFixed(2) + '%';
  if (pct >= 0.01) return pct.toFixed(3) + '%';
  return '<0.01%';
}

function fmtVal(n: number): string {
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(3) + 'B';
  if (n >= 1_000_000)     return (n / 1_000_000).toFixed(2) + 'M';
  if (n >= 1_000)         return (n / 1_000).toFixed(1) + 'K';
  return n.toLocaleString();
}

const CustomTooltip = ({ active, payload }: {
  active?:  boolean;
  payload?: Array<{ name: string; value: number; payload: { pct: number; breakdown: string } }>;
}) => {
  if (!active || !payload?.[0]) return null;
  return (
    <div className="bg-ika-card border border-ika-border rounded-xl p-3 shadow-ika max-w-[200px]">
      <p className="text-xs font-semibold text-white mb-1">{payload[0].name}</p>
      <p className="font-mono font-bold text-white text-sm">{fmtVal(payload[0].value)}</p>
      <p className="text-xs text-ika-muted mb-1.5">{fmtPct(payload[0].payload.pct)} of total</p>
      <p className="text-[10px] text-ika-muted/70 leading-relaxed">{payload[0].payload.breakdown}</p>
    </div>
  );
};

export default function LockedUnlockedChart({ data, loading }: Props) {
  if (loading || !data) {
    return (
      <div className="card p-5">
        <div className="shimmer h-5 w-48 rounded mb-4" />
        <div className="shimmer h-48 rounded-xl" />
      </div>
    );
  }

  const locked   = data.locked_ika + data.locked_isui + data.riddle_pools;
  const unlocked = data.unlocked_ika + data.unlocked_isui + data.nft_reveals + data.riddle_sub;
  const total    = locked + unlocked;

  const lockedPct   = total > 0 ? (locked   / total) * 100 : 0;
  const unlockedPct = total > 0 ? (unlocked / total) * 100 : 0;

  const chartData = [
    {
      name:      'Locked',
      value:     locked,
      color:     '#FF2D78',
      pct:       lockedPct,
      breakdown: 'IKA locks · iSUI locks · Riddle prize pools',
    },
    {
      name:      'Unlocked',
      value:     unlocked,
      color:     '#4DA2FF',
      pct:       unlockedPct,
      breakdown: 'IKA unlocks · iSUI unlocks · NFT reveals · Riddle submissions',
    },
  ];

  return (
    <div className="card p-5 animate-slide-up" style={{ animationDelay: '120ms' }}>
      <div className="flex items-center gap-2 mb-4">
        <div className="w-7 h-7 rounded-lg bg-ika-pink/20 flex items-center justify-center">
          <Lock className="w-3.5 h-3.5 text-ika-pink" />
        </div>
        <h3 className="font-display font-semibold text-sm text-white">Locked vs Unlocked</h3>
        <span className="ml-auto font-mono text-xs text-ika-dim bg-white/5 px-2 py-0.5 rounded-full">
          {fmtVal(total)} total
        </span>
      </div>

      <ResponsiveContainer width="100%" height={180}>
        <PieChart>
          <Pie
            data={chartData}
            cx="50%"
            cy="50%"
            innerRadius={50}
            outerRadius={80}
            paddingAngle={3}
            dataKey="value"
            strokeWidth={0}
          >
            {chartData.map((entry, i) => (
              <Cell key={i} fill={entry.color} opacity={0.9} />
            ))}
          </Pie>
          <Tooltip content={<CustomTooltip />} />
        </PieChart>
      </ResponsiveContainer>

      {/* Legend with breakdown */}
      <div className="grid grid-cols-2 gap-3 mt-2">
        {chartData.map((entry) => (
          <div key={entry.name} className="bg-white/[0.03] border border-white/5 rounded-xl p-3">
            <div className="flex items-center gap-2 mb-1.5">
              <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: entry.color }} />
              <span className="text-xs font-semibold text-white">{entry.name}</span>
              <span className="ml-auto font-mono text-xs font-bold" style={{ color: entry.color }}>
                {fmtPct(entry.pct)}
              </span>
            </div>
            <p className="font-mono text-sm font-bold text-white">{fmtVal(entry.value)}</p>
            <p className="text-[10px] text-ika-muted mt-1 leading-relaxed">{entry.breakdown}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
