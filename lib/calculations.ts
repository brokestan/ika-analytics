import { LockDistributionItem, LockDuration } from './types';
import { getDrizzletRate } from './sui-rpc';

interface LockInput {
  lock_duration: LockDuration;
  ika_amount: number;
}

export function buildLockDistribution(locks: LockInput[]): LockDistributionItem[] {
  const durations: LockDuration[] = [0, 1, 7, 30];
  const labels: Record<LockDuration, string> = {
    0:  'Season Lock',
    1:  '1 Day Lock',
    7:  '7 Day Lock',
    30: '30 Day Lock',
  };
  const total = locks.length || 1;
  return durations.map((d) => {
    const group = locks.filter((l) => l.lock_duration === d);
    return {
      duration:   d,
      label:      labels[d],
      percentage: Math.round((group.length / total) * 100),
      total_nfts: group.length,
      total_ika:  group.reduce((s, l) => s + l.ika_amount, 0),
      rate:       getDrizzletRate(d),
    };
  });
}

export interface ForecastResult {
  current:    number;
  day30:      number;
  day60:      number;
  season_end: number;
}

export function forecastDrizzlets(
  currentTotal:    number,
  totalIkaStaked:  number,
  totalISUIStaked: number,
  avgIkaRate:      number,
  daysLeft:        number
): ForecastResult {
  const dailyIka  = (totalIkaStaked  / 10) * avgIkaRate;
  const dailyISUI = (totalISUIStaked / 10) * 5;
  const daily     = dailyIka + dailyISUI;
  return {
    current:    Math.round(currentTotal),
    day30:      Math.round(currentTotal + daily * 30),
    day60:      Math.round(currentTotal + daily * 60),
    season_end: Math.round(currentTotal + daily * Math.max(daysLeft, 0)),
  };
}

export function formatNumber(value: number, decimals = 0): string {
  if (value >= 1_000_000) return (value / 1_000_000).toFixed(1) + 'M';
  if (value >= 1_000)     return (value / 1_000).toFixed(1) + 'K';
  return value.toFixed(decimals);
}

export function shortenAddress(address: string, chars = 4): string {
  if (!address) return '';
  return `${address.slice(0, chars + 2)}...${address.slice(-chars)}`;
}
