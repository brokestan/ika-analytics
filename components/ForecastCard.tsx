'use client';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { TrendingUp } from 'lucide-react';
import { formatNumber } from '@/lib/calculations';

interface Props {
  current: number; day30: number; day60: number; seasonEnd: number; loading?: boolean;
}

function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number }>; label?: string }) {
  if (!active || !payload?.[0]) return null;
  return (
    <div className="bg-ika-card border border-ika-border rounded-xl p-3 shadow-ika">
      <p className="text-xs text-ika-dim mb-0.5">{label}</p>
      <p className="font-mono font-bold text-white text-sm">{formatNumber(payload[0].value, 0)}</p>
      <p className="text-xs text-ika-muted">drizzlets</p>
    </div>
  );
}

export default function ForecastCard({ current, day30, day60, seasonEnd, loading }: Props) {
  if (loading) return (
    <div className="card p-5">
      <div className="shimmer h-5 w-48 rounded mb-4" />
      <div className="shimmer h-40 rounded-xl" />
    </div>
  );

  const chartData = [
    { label: 'Now',     value: current   },
    { label: '30 Days', value: day30     },
    { label: '60 Days', value: day60     },
    { label: 'Season',  value: seasonEnd },
  ];

  const milestones = [
    { label: '30 Days', value: day30,     color: 'text-cyan-400'    },
    { label: '60 Days', value: day60,     color: 'text-violet-400'  },
    { label: 'Season',  value: seasonEnd, color: 'text-ika-pink'    },
  ];

  return (
    <div className="card p-5 animate-slide-up" style={{ animationDelay: '250ms' }}>
      <div className="flex items-center gap-2 mb-4">
        <div className="w-7 h-7 rounded-lg bg-emerald-500/20 flex items-center justify-center">
          <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
        </div>
        <h3 className="font-display font-semibold text-sm text-white">Drizzlet Forecast</h3>
      </div>
      <ResponsiveContainer width="100%" height={140}>
        <AreaChart data={chartData} margin={{ top: 5, right: 5, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="drizzletGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="#FF2D78" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#FF2D78" stopOpacity={0}   />
            </linearGradient>
          </defs>
          <XAxis dataKey="label" tick={{ fill: '#6B5A8E', fontSize: 10, fontFamily: 'monospace' }} axisLine={false} tickLine={false} />
          <YAxis hide />
          <Tooltip content={<CustomTooltip />} />
          <Area type="monotone" dataKey="value" stroke="#FF2D78" strokeWidth={2} fill="url(#drizzletGradient)"
            dot={{ fill: '#FF2D78', strokeWidth: 0, r: 4 }}
            activeDot={{ fill: '#FF2D78', r: 5, strokeWidth: 0 }} />
        </AreaChart>
      </ResponsiveContainer>
      <div className="grid grid-cols-3 gap-2 mt-3">
        {milestones.map((m) => (
          <div key={m.label} className="bg-white/3 rounded-lg p-2 text-center">
            <p className="text-xs text-ika-muted leading-tight mb-1">{m.label}</p>
            <p className={`font-mono font-bold text-sm ${m.color}`}>{formatNumber(m.value, 0)}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
