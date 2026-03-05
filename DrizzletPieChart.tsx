'use client';
import {
  PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer
} from 'recharts';
import { Droplets } from 'lucide-react';
import { formatNumber } from '@/lib/calculations';

interface DrizzletDistribution {
  locked_ika_rewards: number;
  isui_rewards: number;
  unlocked_drizzlets: number;
  riddle_rewards: number;
}

const SEGMENTS = [
  { key: 'locked_ika_rewards', label: 'Locked IKA Rewards', color: '#FF2D78' },
  { key: 'isui_rewards',       label: 'iSUI Rewards',        color: '#A855F7' },
  { key: 'unlocked_drizzlets', label: 'Unlocked Drizzlets',  color: '#06B6D4' },
  { key: 'riddle_rewards',     label: 'Riddle Rewards',      color: '#F59E0B' },
] as const;

interface Props {
  data: DrizzletDistribution | null;
  loading?: boolean;
}

const CustomTooltip = ({ active, payload }: { active?: boolean; payload?: Array<{ name: string; value: number }> }) => {
  if (!active || !payload?.[0]) return null;
  return (
    <div className="bg-ika-card border border-ika-border rounded-xl p-3 shadow-ika">
      <p className="text-xs text-ika-dim mb-0.5">{payload[0].name}</p>
      <p className="font-mono font-bold text-white text-sm">{formatNumber(payload[0].value, 0)}</p>
      <p className="text-xs text-ika-muted">drizzlets</p>
    </div>
  );
};

const CustomLegend = ({ payload }: { payload?: Array<{ value: string; color: string }> }) => (
  <div className="flex flex-wrap gap-x-4 gap-y-2 justify-center mt-2">
    {payload?.map((entry) => (
      <div key={entry.value} className="flex items-center gap-1.5">
        <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: entry.color }} />
        <span className="text-xs text-ika-dim">{entry.value}</span>
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

  const chartData = SEGMENTS.map((s) => ({
    name:  s.label,
    value: Math.max(0, data[s.key]),
    color: s.color,
  })).filter((d) => d.value > 0);

  const total = chartData.reduce((s, d) => s + d.value, 0);

  if (total === 0) {
    chartData.push(
      { name: 'No data yet', value: 1, color: '#2A1F3D' }
    );
  }

  return (
    <div className="card p-5 animate-slide-up" style={{ animationDelay: '100ms' }}>
      {/* Header */}
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

      <ResponsiveContainer width="100%" height={260}>
        <PieChart>
          <Pie
            data={chartData}
            cx="50%"
            cy="45%"
            innerRadius={65}
            outerRadius={100}
            paddingAngle={3}
            dataKey="value"
            strokeWidth={0}
          >
            {chartData.map((entry, i) => (
              <Cell key={i} fill={entry.color} opacity={0.9} />
            ))}
          </Pie>
          <Tooltip content={<CustomTooltip />} />
          <Legend content={<CustomLegend />} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
