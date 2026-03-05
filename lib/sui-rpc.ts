export const RPC_URL = process.env.SUI_RPC_URL || 'https://fullnode.mainnet.sui.io:443';

export function toHumanIka(raw: string | number): number {
  return Number(raw) / 1e9;
}

export function getDrizzletRate(duration: number): number {
  if (duration === 1)  return 1;
  if (duration === 7)  return 2;
  if (duration === 30) return 3;
  return 5;
}
