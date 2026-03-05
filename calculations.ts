import { LockDuration, LockDistributionItem } from './types';
import { getDrizzletRate } from './sui-rpc';

// ─── Drizzlet Calculations ────────────────────────────────────────────────────

export function calcIkaDrizzletsForLock(
  ikaAmount: number,
  durationValue: LockDuration,
  daysElapsed: number
): number {
  const rate = getDrizzletRate(durationValue);
  const fullDays = Math.min(Math.floor(daysElapsed), effectiveDays(durationValue));
  return (ikaAmount / 10) * rate * fullDays;
}

export function calcISuiDrizzletsForLock(isuiAmount: number, daysElapsed: number): number {
  return isuiAmount * Math.floor(daysElapsed);
}

// For season lock, assume 90-day season
export function effectiveDays(duration: LockDuration): number {
  if (duration === 0)  return 90;
  if (duration === 1)  return 1;
  if (duration === 7)  return 7;
  return 30;
}

// ─── Forecast ─────────────────────────────────────────────────────────────────

export interface ForecastResult {
  current: number;
  day30: number;
  day60: number;
  season_end: number;
}

export function forecastDrizzlets(
  currentDrizzlets: number,
  totalIkaActive: number,    // sum of active IKA across all locks
  totalISuiActive: number,   // sum of active iSUI
  averageDailyIkaRate: number, // weighted avg drizzlets per IKA per day
  daysRemaining: number = 60   // days left in season
): ForecastResult {
  const dailyIka  = (totalIkaActive / 10) * averageDailyIkaRate;
  const dailyISui = totalISuiActive * 1; // 1 drizzlet per iSUI per day

  const dailyTotal = dailyIka + dailyISui;

  return {
    current:    Math.round(currentDrizzlets),
    day30:      Math.round(currentDrizzlets + dailyTotal * 30),
    day60:      Math.round(currentDrizzlets + dailyTotal * 60),
    season_end: Math.round(currentDrizzlets + dailyTotal * daysRemaining),
  };
}

// ─── Lock Distribution ────────────────────────────────────────────────────────

export function buildLockDistribution(
  locks: Array<{ lock_duration: LockDuration; ika_amount: number }>
): LockDistributionItem[] {
  const groups: Record<LockDuration, { count: number; ika: number }> = {
    0: { count: 0, ika: 0 },
    1: { count: 0, ika: 0 },
    7: { count: 0, ika: 0 },
    30: { count: 0, ika: 0 },
  };

  for (const lock of locks) {
    const d = lock.lock_duration;
    groups[d].count += 1;
    groups[d].ika   += lock.ika_amount;
  }

  const total = locks.length || 1;

  const labels: Record<LockDuration, string> = {
    0:  'Season Lock',
    1:  '1 Day Lock',
    7:  '7 Day Lock',
    30: '30 Day Lock',
  };

  return ([0, 1, 7, 30] as LockDuration[]).map((d) => ({
    duration:   d,
    label:      labels[d],
    percentage: Math.round((groups[d].count / total) * 100),
    total_nfts: groups[d].count,
    total_ika:  groups[d].ika,
    rate:       getDrizzletRate(d),
  }));
}

// ─── Number Formatting ────────────────────────────────────────────────────────

export function formatNumber(n: number, decimals = 2): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(decimals)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(decimals)}K`;
  return n.toFixed(decimals);
}

export function formatIka(raw: number): string {
  return formatNumber(raw, 2);
}

export function formatDrizzlets(n: number): string {
  return formatNumber(n, 0);
}

export function shortenAddress(addr: string): string {
  if (!addr || addr.length < 16) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}
