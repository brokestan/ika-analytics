export function formatNumber(n: number, decimals = 2): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(decimals)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(decimals)}K`;
  return n.toFixed(decimals);
}

export function shortenAddress(addr: string): string {
  if (!addr || addr.length < 16) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function getDrizzletRate(duration: number): number {
  if (duration === 1)  return 1;
  if (duration === 7)  return 2;
  if (duration === 30) return 3;
  return 5;
}
