'use client';
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Droplets } from 'lucide-react';
import { formatNumber } from '@/lib/calculations';

interface DrizzletDistribution {
  locked_ika_rewards: number;  // all still-active lock drizzlets (IKA + iSUI)
  isui_rewards:       number;  // realized iSUI unlock drizzlets
  unlocked_drizzlets: number;  // realized IKA unlock drizzlets
  riddle_rewards:     number;  // riddle submission drizzlets
  nft_rewards:        number;  // NFT reveal drizzlets (passed separately)
}

const SEGMENTS = [
  { key: 'locked_ika_rewards', label: 'Active Locks',        color: '#FF2D78' },
  { key: 'unlocked_drizzlets', label: 'Unlocked IKA',        color: '#FB7185' },
  { key: 'isui_rewards',       label: 'iSUI Rewards',        color: '#4DA2FF' },
  { key: 'nft_rewards',        label: 'NFT Reveals',         color: '#F59E0B' },
  { key: 'riddle_rewards',     label: 'Riddle Submissions',  color: '#EAB308' },
] as const;

interface Props {
  data:        DrizzletDistribution | null;
  loading?:    boolean;
}

const CustomTooltip = ({ active, payload }: {
  active?:   boolean;
  payload?:  Array<{ name: string; value: number; payload: { pct: number } }>;
}) => {
  if (!active || !payload?.[0]) return null;
  return (
    <div className="bg-ika-card border border-ika-border rounded-xl p-3 shadow-ika">
      <p className="text-xs text-ika-dim mb-0.5">{payload[0].name}</p>
      <p className="font-mono font-bold text-white text-sm">{formatNumber(payload[0].value, 0)}</p>
      <p className="text-xs text-ika-muted">{payload[0].payload.pct.toFixed(1)}% of total</p>
    </div>
  );
};

const CustomLegend = ({
  payload,
}: {
  payload?: Array<{ value: string; color: string; payload: { value: number; pct: number } }>;
}) => (
  <div className="flex flex-wrap gap-x-4 gap-y-2 justify-center mt-2">
    {payload?.map((entry) => (
      <div key={entry.value} className="flex items-center gap-1.5">
        <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: entry.color }} />
        <span className="text-xs text-ika-dim">{entry.value}</span>
        <span className="text-xs font-mono font-bold" style={{ color: entry.color }}>
          {entry.payload.pct.toFixed(1)}%
        </span>
      </div>
    ))}
  </div>
);

export default function DrizzletPieChart({ data, loading }: Props) {
  if (loading || !data) {
    return (
      <div className="card p-5">
        <div className="shimmer h-5 w-48 rounded mb-4" />
        <div className="shimmer h-64 rounded-xl" />
      </div>
    );
  }

  const total = SEGMENTS.reduce((s, seg) => s + Math.max(0, data[seg.key]), 0);

  const chartData = SEGMENTS
    .map((s) => ({
      name:  s.label,
      value: Math.max(0, data[s.key]),
      color: s.color,
      pct:   total > 0 ? (Math.max(0, data[s.key]) / total) * 100 : 0,
    }))
    .filter((d) => d.value > 0);

  if (total === 0) {
    chartData.push({ name: 'No data yet', value: 1, color: '#2A1F3D', pct: 100 });
  }

  return (
    <div className="card p-5 animate-slide-up" style={{ animationDelay: '100ms' }}>
      <div className="flex items-center gap-2 mb-4">
        <div className="w-7 h-7 rounded-lg bg-ika-pink/20 flex items-center justify-center">
          <Droplets className="w-3.5 h-3.5 text-ika-pink" />
        </div>
        <h3 className="font-display font-semibold text-sm text-white">Drizzlet Distribution</h3>
        {total > 0 && (
          <span className="ml-auto font-mono text-xs text-ika-dim bg-white/5 px-2 py-0.5 rounded-full">
            {formatNumber(total, 0)} total
          </span>
        )}
      </div>

      <ResponsiveContainer width="100%" height={280}>
        <PieChart>
          <Pie
            data={chartData}
            cx="50%"
            cy="42%"
            innerRadius={60}
            outerRadius={100}
            paddingAngle={2}
            dataKey="value"
            strokeWidth={0}
          >
            {chartData.map((entry, i) => (
              <Cell key={i} fill={entry.color} opacity={0.88} />
            ))}
          </Pie>
          <Tooltip content={<CustomTooltip />} />
          <Legend content={<CustomLegend />} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
