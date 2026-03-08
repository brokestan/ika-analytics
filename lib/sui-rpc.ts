import {
  StakedIkaLockedFields,
  StakedIkaUnlockedFields,
  ISUILockedFields,
  ISUIUnlockedFields,
  SuiObject,
  LockDuration,
} from './types';

const RPC_URL = process.env.SUI_RPC_URL || 'https://fullnode.mainnet.sui.io:443';

// Hardcoded — confirmed from your transaction data
const PKG =
  process.env.IKA_PACKAGE_ID ||
  '0x7de6bc92a5b7e07d09faecbff30f4c0ef751b97cafbd29fef8898a822a325d27';

const RIDDLE_POOL_OBJECT =
  process.env.RIDDLE_POOL_OBJECT_ID ||
  '0x92c105c5cf5713a751ee18e7a007fbb238ae242b7234cf1ee25be51974eef334';

// Event type strings — exact names confirmed from package tx list
const EVENT_IKA_LOCK    = `${PKG}::event_wrapper::Event<${PKG}::tasks::StakedIkaLocked>`;
const EVENT_IKA_UNLOCK  = `${PKG}::event_wrapper::Event<${PKG}::tasks::StakedIkaUnlocked>`;
const EVENT_ISUI_LOCK   = `${PKG}::event_wrapper::Event<${PKG}::tasks::ISuiLocked>`;
const EVENT_ISUI_UNLOCK = `${PKG}::event_wrapper::Event<${PKG}::tasks::ISuiUnlocked>`;

// ─── RPC Base ─────────────────────────────────────────────────────────────────

async function rpcCall<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    next: { revalidate: 0 },
  });
  if (!res.ok) throw new Error(`RPC HTTP ${res.status}`);
  const json = await res.json() as { result?: T; error?: { message: string } };
  if (json.error) throw new Error(`RPC error: ${json.error.message}`);
  return json.result as T;
}

// ─── Shared Types ─────────────────────────────────────────────────────────────

export interface EventCursor {
  txDigest: string;
  eventSeq: string;
}

export interface EventPage<T> {
  data: T[];
  nextCursor: EventCursor | null;
  hasNextPage: boolean;
}

export interface LockEventFlat {
  txDigest: string;
  timestampMs: string;
  account: string;
  staked_ika_balance: string;
  state_time_ts: string;
  lock_duration: LockDuration;
}

export interface UnlockEventFlat {
  txDigest: string;
  timestampMs: string;
  account: string;
  staked_ika_balance: string;
  drizzlets_earned: string;
  state_time_ts: string;
  unlock_time_ts: string;
}

export interface ISUILockEventFlat {
  txDigest: string;
  timestampMs: string;
  account: string;
  isui_balance: string;
  state_time_ts: string;
}

export interface ISUIUnlockEventFlat {
  txDigest: string;
  timestampMs: string;
  account: string;
  isui_balance: string;
  drizzlets_earned: string;
  state_time_ts: string;
  unlock_time_ts: string;
}

// ─── Generic event page fetcher ───────────────────────────────────────────────

async function fetchEventPage<T>(
  eventType: string,
  cursor: EventCursor | null
): Promise<{
  data: Array<{
    id: { txDigest: string; eventSeq: string };
    parsedJson: { pos0: T };
    timestampMs: string;
  }>;
  nextCursor: EventCursor | null;
  hasNextPage: boolean;
}> {
  return rpcCall('suix_queryEvents', [
    { MoveEventType: eventType },
    cursor,
    50,
    false,
  ]);
}

// ─── Lock Duration from Tx Input[3] ──────────────────────────────────────────
// lock_staked_ika args: [tasks_obj, clock_obj, staked_ika_nft, pure u64 duration]
// values: 0=season, 1=1day, 7=7day, 30=30day

export async function fetchLockDurations(
  txDigests: string[]
): Promise<Record<string, LockDuration>> {
  if (txDigests.length === 0) return {};
  try {
    const results = await rpcCall<Array<{
      transaction?: {
        data?: {
          transaction?: {
            inputs?: Array<{ type: string; valueType?: string; value?: string }>;
          };
        };
      };
    } | null>>('sui_multiGetTransactionBlocks', [
      txDigests,
      { showInput: true, showEffects: false, showEvents: false },
    ]);

    const map: Record<string, LockDuration> = {};
    for (let i = 0; i < txDigests.length; i++) {
      const tx = results[i];
      const inputs = tx?.transaction?.data?.transaction?.inputs;
      const pureInput = inputs?.find(
        (inp) => inp.type === 'pure' && inp.valueType === 'u64'
      );
      const raw = parseInt(pureInput?.value ?? '0');
      const dur: LockDuration = raw === 1 ? 1 : raw === 7 ? 7 : raw === 30 ? 30 : 0;
      map[txDigests[i]] = dur;
    }
    return map;
  } catch (err) {
    console.error('[fetchLockDurations]', err);
    return {};
  }
}

// ─── IKA Lock Events ──────────────────────────────────────────────────────────

export async function fetchLockStakeEvents(
  cursor: EventCursor | null = null
): Promise<EventPage<LockEventFlat>> {
  try {
    const result = await fetchEventPage<StakedIkaLockedFields>(EVENT_IKA_LOCK, cursor);
    

    return {
      data: result.data.map((e) => ({
        txDigest:           e.id.txDigest,
        timestampMs:        e.timestampMs,
        account:            e.parsedJson.pos0.account,
        staked_ika_balance: e.parsedJson.pos0.staked_ika_balance,
        state_time_ts:      e.parsedJson.pos0.state_time_ts,
        lock_duration: 0,
      })),
      nextCursor:  result.nextCursor,
      hasNextPage: result.hasNextPage,
    };
  } catch (err) {
    console.error('[fetchLockStakeEvents]', err);
    throw err;
  }
}

// ─── IKA Unlock Events ────────────────────────────────────────────────────────

export async function fetchUnlockEvents(
  cursor: EventCursor | null = null
): Promise<EventPage<UnlockEventFlat>> {
  try {
    const result = await fetchEventPage<StakedIkaUnlockedFields>(EVENT_IKA_UNLOCK, cursor);
    return {
      data: result.data.map((e) => ({
        txDigest:           e.id.txDigest,
        timestampMs:        e.timestampMs,
        account:            e.parsedJson.pos0.account,
        staked_ika_balance: e.parsedJson.pos0.staked_ika_balance,
        drizzlets_earned:   e.parsedJson.pos0.drizzlets_earned,
        state_time_ts:      e.parsedJson.pos0.state_time_ts,
        unlock_time_ts:     e.parsedJson.pos0.unlock_time_ts,
      })),
      nextCursor:  result.nextCursor,
      hasNextPage: result.hasNextPage,
    };
  } catch (err) {
    console.error('[fetchUnlockEvents]', err);
    throw err;
  }
}

// ─── iSUI Lock Events ─────────────────────────────────────────────────────────

export async function fetchISUILockEvents(
  cursor: EventCursor | null = null
): Promise<EventPage<ISUILockEventFlat>> {
  try {
    const result = await fetchEventPage<ISUILockedFields>(EVENT_ISUI_LOCK, cursor);
    return {
      data: result.data.map((e) => ({
        txDigest:      e.id.txDigest,
        timestampMs:   e.timestampMs,
        account:       e.parsedJson.pos0.account,
        isui_balance:  e.parsedJson.pos0.i_sui_balance,
        state_time_ts: e.parsedJson.pos0.state_time_ts,
      })),
      nextCursor:  result.nextCursor,
      hasNextPage: result.hasNextPage,
    };
  } catch (err) {
    console.error('[fetchISUILockEvents] EVENT:', EVENT_ISUI_LOCK, 'ERR:', err);
    throw err;
  }
}

// ─── iSUI Unlock Events ───────────────────────────────────────────────────────

export async function fetchISUIUnlockEvents(
  cursor: EventCursor | null = null
): Promise<EventPage<ISUIUnlockEventFlat>> {
  try {
    const result = await fetchEventPage<ISUIUnlockedFields>(EVENT_ISUI_UNLOCK, cursor);
    return {
      data: result.data.map((e) => ({
        txDigest:         e.id.txDigest,
        timestampMs:      e.timestampMs,
        account:          e.parsedJson.pos0.account,
        isui_balance:     e.parsedJson.pos0.i_sui_balance,
        drizzlets_earned: e.parsedJson.pos0.drizzlets_earned,
        state_time_ts:    e.parsedJson.pos0.state_time_ts,
        unlock_time_ts:   e.parsedJson.pos0.unlock_time_ts,
      })),
      nextCursor:  result.nextCursor,
      hasNextPage: result.hasNextPage,
    };
  } catch (err) {
    console.error('[fetchISUIUnlockEvents] EVENT:', EVENT_ISUI_UNLOCK, 'ERR:', err);
    throw err;
  }
}

// ─── Riddle Pool ──────────────────────────────────────────────────────────────

export interface RiddlePoolFields {
  pool1: number;
  pool2: number;
  pool3: number;
}

export async function fetchRiddlePool(): Promise<RiddlePoolFields | null> {
  try {
    const obj = await rpcCall<SuiObject>('sui_getObject', [
      RIDDLE_POOL_OBJECT,
      { showContent: true },
    ]);
    const fields = (obj as any)?.data?.content?.fields as Record<string, unknown> | undefined;
    if (!fields) return null;

    // Confirmed field names from chain object data (riddle_one_pool etc, raw drizzlets — NO 1e9 division)
    return {
      pool1: Number(fields.riddle_one_pool   ?? 0),
      pool2: Number(fields.riddle_two_pool   ?? 0),
      pool3: Number(fields.riddle_three_pool ?? 0),
    };
  } catch (err) {
    console.error('[fetchRiddlePool]', err);
    return null;
  }
}

// ─── Utilities ────────────────────────────────────────────────────────────────

export function toHumanIka(raw: string | number): number {
  return Number(raw) / 1e9;
}

export function toHumanISUI(raw: string | number): number {
  return Number(raw) / 1e9;
}

export function getLockDurationLabel(d: number): string {
  if (d === 0) return 'Season Lock';
  if (d === 1) return '1 Day Lock';
  if (d === 7) return '7 Day Lock';
  return '30 Day Lock';
}

export function getDrizzletRate(duration: LockDuration | number): number {
  if (duration === 1)  return 1;
  if (duration === 7)  return 2;
  if (duration === 30) return 3;
  return 5; // season (0)
}

// iSUI is season-only staking — same 5x rate as season IKA lock
export const ISUI_DRIZZLET_RATE = 5;

export function calcIkaDrizzlets(
  ikaAmount: number,
  daysElapsed: number,
  rate: number
): number {
  return (ikaAmount / 10) * rate * Math.floor(daysElapsed);
}

export function calcISUIDrizzlets(
  isuiAmount: number,
  daysElapsed: number
): number {
  return (isuiAmount / 10) * ISUI_DRIZZLET_RATE * Math.floor(daysElapsed);
}
