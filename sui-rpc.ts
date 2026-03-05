import { LockStakeIkaEvent, SuiObject, UnlockStakedIkaEvent } from './types';

const RPC_URL = process.env.SUI_RPC_URL || 'https://fullnode.mainnet.sui.io:443';
const RIDDLE_POOL_OBJECT = process.env.RIDDLE_POOL_OBJECT_ID ||
  '0x92c105c5cf5713a751ee18e7a007fbb238ae242b7234cf1ee25be51974eef334';

// ─── RPC Base ─────────────────────────────────────────────────────────────────

async function rpcCall<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    next: { revalidate: 0 },
  });

  if (!res.ok) throw new Error(`RPC HTTP error: ${res.status}`);
  const json = await res.json() as { result?: T; error?: { message: string } };
  if (json.error) throw new Error(`RPC error: ${json.error.message}`);
  return json.result as T;
}

// ─── Riddle Pool ──────────────────────────────────────────────────────────────

export interface RiddlePoolFields {
  pool1: string;
  pool2: string;
  pool3: string;
}

export async function fetchRiddlePool(): Promise<RiddlePoolFields | null> {
  try {
    const obj = await rpcCall<SuiObject>('sui_getObject', [
      RIDDLE_POOL_OBJECT,
      { showContent: true },
    ]);

    const fields = obj?.content?.fields as Record<string, unknown> | undefined;
    if (!fields) return null;

    // Attempt common field name patterns
    return {
      pool1: String(
        fields.pool_1 ?? fields.pool1 ?? fields.riddle_pool_1 ??
        (Array.isArray(fields.pools) ? (fields.pools as string[])[0] : '0') ?? '0'
      ),
      pool2: String(
        fields.pool_2 ?? fields.pool2 ?? fields.riddle_pool_2 ??
        (Array.isArray(fields.pools) ? (fields.pools as string[])[1] : '0') ?? '0'
      ),
      pool3: String(
        fields.pool_3 ?? fields.pool3 ?? fields.riddle_pool_3 ??
        (Array.isArray(fields.pools) ? (fields.pools as string[])[2] : '0') ?? '0'
      ),
    };
  } catch (err) {
    console.error('[fetchRiddlePool] error:', err);
    return null;
  }
}

// ─── Events ───────────────────────────────────────────────────────────────────

interface EventPage<T> {
  data: T[];
  nextCursor: { txDigest: string; eventSeq: string } | null;
  hasNextPage: boolean;
}

// Fetches all lock_stake_ika events paginated
export async function fetchLockStakeEvents(
  cursor: { txDigest: string; eventSeq: string } | null = null
): Promise<EventPage<LockStakeIkaEvent & { txDigest: string; timestampMs: string }>> {
  try {
    const params: unknown[] = [
      { MoveEventType: `${process.env.IKA_PACKAGE_ID || ''}::ika_staking::LockStakeIka` },
      cursor,
      50,
      false, // ascending = false (newest first for incremental sync)
    ];

    const result = await rpcCall<{
      data: Array<{
        id: { txDigest: string; eventSeq: string };
        parsedJson: LockStakeIkaEvent;
        timestampMs: string;
      }>;
      nextCursor: { txDigest: string; eventSeq: string } | null;
      hasNextPage: boolean;
    }>('suix_queryEvents', params);

    return {
      data: result.data.map((e) => ({
        ...e.parsedJson,
        txDigest: e.id.txDigest,
        timestampMs: e.timestampMs,
      })),
      nextCursor: result.nextCursor,
      hasNextPage: result.hasNextPage,
    };
  } catch (err) {
    console.error('[fetchLockStakeEvents] error:', err);
    return { data: [], nextCursor: null, hasNextPage: false };
  }
}

export async function fetchUnlockEvents(
  cursor: { txDigest: string; eventSeq: string } | null = null
): Promise<EventPage<UnlockStakedIkaEvent & { txDigest: string; timestampMs: string }>> {
  try {
    const params: unknown[] = [
      { MoveEventType: `${process.env.IKA_PACKAGE_ID || ''}::ika_staking::UnlockStakedIka` },
      cursor,
      50,
      false,
    ];

    const result = await rpcCall<{
      data: Array<{
        id: { txDigest: string; eventSeq: string };
        parsedJson: UnlockStakedIkaEvent;
        timestampMs: string;
      }>;
      nextCursor: { txDigest: string; eventSeq: string } | null;
      hasNextPage: boolean;
    }>('suix_queryEvents', params);

    return {
      data: result.data.map((e) => ({
        ...e.parsedJson,
        txDigest: e.id.txDigest,
        timestampMs: e.timestampMs,
      })),
      nextCursor: result.nextCursor,
      hasNextPage: result.hasNextPage,
    };
  } catch (err) {
    console.error('[fetchUnlockEvents] error:', err);
    return { data: [], nextCursor: null, hasNextPage: false };
  }
}

// ─── Utility ─────────────────────────────────────────────────────────────────

export function toHumanIka(raw: string | number): number {
  return Number(raw) / 1e9;
}

export function toHumanISui(raw: string | number): number {
  return Number(raw) / 1e9;
}

export function getLockDurationLabel(d: number): string {
  if (d === 0) return 'Season Lock';
  if (d === 1) return '1 Day Lock';
  if (d === 7) return '7 Day Lock';
  return '30 Day Lock';
}

export function getDrizzletRate(duration: number): number {
  if (duration === 1)  return 1;
  if (duration === 7)  return 2;
  if (duration === 30) return 3;
  return 5; // season (0)
}

export function calcIkaDrizzlets(ikaAmount: number, durationDays: number, rate: number): number {
  // drizzlets = (ika / 10) * rate * days
  return (ikaAmount / 10) * rate * durationDays;
}

export function calcISuiDrizzlets(isuiAmount: number, daysElapsed: number): number {
  const fullDays = Math.floor(daysElapsed);
  return isuiAmount * fullDays;
}
