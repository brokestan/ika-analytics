'use client';
import {
  Coins, Droplets, Lock, Unlock, LayoutGrid,
  Users, Sparkles, TrendingUp, type LucideIcon,
} from 'lucide-react';
import clsx from 'clsx';
import { formatNumber } from '@/lib/calculations';

const ICON_MAP: Record<string, LucideIcon> = {
  Coins, Droplets, Lock, Unlock, LayoutGrid, Users, Sparkles, TrendingUp,
};

interface MetricCardProps {
  title: string;
  value: number | string;
  subtitle?: string;
  iconName: string;
  iconColor?: string;
  accent?: boolean;
  prefix?: string;
  suffix?: string;
  loading?: boolean;
  decimals?: number;
  animationDelay?: number;
}

export default function MetricCard({
  title, value, subtitle, iconName,
  iconColor = 'text-ika-pink', accent = false,
  prefix = '', suffix = '', loading = false,
  decimals = 2, animationDelay = 0,
}: MetricCardProps) {
  const Icon = ICON_MAP[iconName] ?? Coins;

  const displayValue =
    typeof value === 'number'
      ? `${prefix}${formatNumber(value, decimals)}${suffix}`
      : `${prefix}${value}${suffix}`;

  if (loading) {
    return (
      <div className="card p-4 sm:p-5 space-y-3">
        <div className="flex items-start justify-between">
          <div className="shimmer h-3 w-24 rounded" />
          <div className="shimmer h-8 w-8 rounded-lg" />
        </div>
        <div className="shimmer h-8 w-28 rounded" />
        <div className="shimmer h-3 w-14 rounded" />
      </div>
    );
  }

  return (
    <div
      className={clsx('card card-hover p-4 sm:p-5 animate-slide-up', accent && 'border-ika-pink/25')}
      style={{ animationDelay: `${animationDelay}ms` }}
    >
      <div className="flex items-start justify-between mb-3 gap-2">
        <p className="text-[11px] font-semibold text-ika-muted tracking-widest uppercase leading-tight">
          {title}
        </p>
        <div className={clsx('flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center', accent ? 'bg-ika-pink/20' : 'bg-white/5')}>
          <Icon className={clsx('w-4 h-4', iconColor)} />
        </div>
      </div>
      <p className={clsx('number-display font-bold leading-none text-[22px] sm:text-[26px]', accent ? 'text-ika-gradient' : 'text-white')}>
        {displayValue}
      </p>
      {subtitle && <p className="text-[11px] text-ika-muted mt-2">{subtitle}</p>}
      {accent && <div className="absolute bottom-0 left-4 right-4 h-[2px] bg-ika-gradient rounded-full" />}
    </div>
  );
    }
