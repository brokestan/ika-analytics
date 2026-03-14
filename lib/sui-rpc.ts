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

const V4_PKG =
  process.env.IKA_V4_PACKAGE_ID ||
  '0x765307507478ca630ddc0c44ab3bb9e83c3aa98aea2777a4f0aea0ade4a853f8';

export const RIDDLE_DRIZZLETS_PER_SUBMISSION = 31;

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
    cache: 'no-store' as RequestInit['cache'],
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

export async function fetchDurationsForBatch(
  txDigests: string[]
): Promise<Record<string, number>> {
  if (txDigests.length === 0) return {};
  const results = await rpcCall<Array<any | null>>(
    'sui_multiGetTransactionBlocks',
    [txDigests, { showInput: true, showEffects: false, showEvents: false }]
  );
  const map: Record<string, number> = {};
  for (let i = 0; i < txDigests.length; i++) {
    const inputs = results[i]?.transaction?.data?.transaction?.inputs as Array<{
      type: string; valueType?: string; value?: string;
    }> | undefined;
    const pureInput = inputs?.find(i => i.type === 'pure' && i.valueType === 'u64');
    const raw = parseInt(pureInput?.value ?? '0');
    map[txDigests[i]] = raw === 1 ? 1 : raw === 7 ? 7 : raw === 30 ? 30 : 0;
  }
  return map;
}

const NFT_RARITY_BASE: Record<string, number> = {
  Common: 1500,
  Rare: 2000,
  Epic: 4000,
  Legendary: 7500,
  Mythic: 20000,
};

export function calcNftDrizzlets(rarity: string, level: number): number {
  const base = NFT_RARITY_BASE[rarity] ?? 1500;
  return base + level * 100;
}

export async function fetchNftRevealEvents(
  cursor: EventCursor | null = null
): Promise<EventPage<any>> {
  try {
    const result = await rpcCall<{
      data: Array<{
        id: { txDigest: string; eventSeq: string };
        parsedJson: {
          account: string;
          ika_chan_nft_id: string;
          ink_droplets_earned: string;
          level: number;
          rarity: string;
        };
        timestampMs: string;
      }>;
      nextCursor: EventCursor | null;
      hasNextPage: boolean;
    }>('suix_queryEvents', [
      { MoveEventType: '0x0b490b62d277395afdc9b5349f93660e8672be6de9e83dca6381d300eb892e7a::ink_sack_tasks::StakeIkaChanNFTEarnedEvent' },
      cursor,
      50,
      false,
    ]);
    return {
      data: result.data.map((e) => ({
        txDigest:            e.id.txDigest,
        eventSeq:            e.id.eventSeq,
        timestampMs:         e.timestampMs,
        account:             e.parsedJson.account,
        ika_chan_nft_id:     e.parsedJson.ika_chan_nft_id,
        ink_droplets_earned: e.parsedJson.ink_droplets_earned,
        level:               e.parsedJson.level,
        rarity:              e.parsedJson.rarity,
      })),
      nextCursor:  result.nextCursor,
      hasNextPage: result.hasNextPage,
    };
  } catch (err) {
    console.error('[fetchNftRevealEvents]', err);
    throw err;
  }
}

export async function fetchMfSquidMaidenMintEvents(
  cursor: EventCursor | null = null
): Promise<EventPage<any>> {
  try {
    const result = await rpcCall<{
      data: Array<{
        id: { txDigest: string; eventSeq: string };
        parsedJson: { id: string };
        sender: string;
        timestampMs: string;
      }>;
      nextCursor: EventCursor | null;
      hasNextPage: boolean;
    }>('suix_queryEvents', [
      { MoveEventType: '0x3533437eabe66f05207aec78857efad86f42c2be84e2bbd63692c7c37fd349fb::mf_squid_maiden::MfSquidMaidenMinted' },
      cursor,
      50,
      false,
    ]);
    return {
      data: result.data.map((e) => ({
        txDigest:    e.id.txDigest,
        eventSeq:    e.id.eventSeq,
        timestampMs: e.timestampMs,
        wallet:      e.sender,
        nft_id:      e.parsedJson.id,
      })),
      nextCursor:  result.nextCursor,
      hasNextPage: result.hasNextPage,
    };
  } catch (err) {
    console.error('[fetchMfSquidMaidenMintEvents]', err);
    throw err;
  }
}

export async function fetchTransactionEventsInBatch(
  txDigests: string[]
): Promise<Record<string, string>> {
  if (txDigests.length === 0) return {};
  const results = await rpcCall<Array<{
    events?: Array<{ type: string; parsedJson: { id?: string } }>;
  } | null>>('sui_multiGetTransactionBlocks', [
    txDigests,
    { showEvents: true, showInput: false, showEffects: false },
  ]);
  const map: Record<string, string> = {};
  for (let i = 0; i < txDigests.length; i++) {
    const events = results[i]?.events ?? [];
    const nftUpdated = events.find(e =>
      e.type.includes('::ika_chan_updater::NFTUpdated')
    );
    if (nftUpdated?.parsedJson?.id) {
      map[txDigests[i]] = nftUpdated.parsedJson.id;
    }
  }
  return map;
}

export async function fetchIkaChanNftObjects(
  objectIds: string[]
): Promise<Record<string, { level: number; rarity: string }>> {
  if (objectIds.length === 0) return {};
  const results = await rpcCall<Array<{
    data?: {
      content?: {
        fields?: {
          metadata?: {
            fields?: {
              level?: number;
              rarity?: string;
            };
          };
        };
      };
    };
  } | null>>('sui_multiGetObjects', [
    objectIds,
    { showContent: true },
  ]);
  const map: Record<string, { level: number; rarity: string }> = {};
  for (let i = 0; i < objectIds.length; i++) {
    const fields = results[i]?.data?.content?.fields?.metadata?.fields;
    if (fields?.level !== undefined && fields?.rarity) {
      map[objectIds[i]] = {
        level:  Number(fields.level),
        rarity: String(fields.rarity),
      };
    }
  }
  return map;
}

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

// ─── Riddle Submissions ───────────────────────────────────────────────────────

export interface RiddleSubmissionFlat {
  txDigest:       string;
  timestampMs:    string;
  wallet_address: string;
  riddle_number:  number;
}

export async function fetchRiddleSubmissions(
  cursor: EventCursor | null = null
): Promise<EventPage<RiddleSubmissionFlat>> {
  try {
    const result = await rpcCall<{
      data: Array<{
        digest:      string;
        timestampMs: string;
        transaction: {
          data: {
            transaction: {
              inputs: Array<{
                type:       string;
                valueType?: string;
                value?:     string;
              }>;
            };
            sender: string;
          };
        };
      }>;
      nextCursor:  string | null;
      hasNextPage: boolean;
    }>('suix_queryTransactionBlocks', [
      {
        filter: {
          MoveFunction: {
            package:  V4_PKG,
            module:   'tasks',
            function: 'submit_riddle_answer',
          },
        },
        options: { showInput: true },
      },
      cursor ? cursor.txDigest : null,
      100,
      false,
    ]);

    const data: RiddleSubmissionFlat[] = result.data.map(tx => {
      const inputs     = tx.transaction?.data?.transaction?.inputs ?? [];
      const riddleNum  = inputs[1]?.value ? parseInt(inputs[1].value, 10) : 0;
      return {
        txDigest:       tx.digest,
        timestampMs:    tx.timestampMs,
        wallet_address: tx.transaction.data.sender,
        riddle_number:  riddleNum,
      };
    });

    const nextCursor: EventCursor | null = result.nextCursor
      ? { txDigest: result.nextCursor, eventSeq: '0' }
      : null;

    return { data, nextCursor, hasNextPage: result.hasNextPage };
  } catch (err) {
    console.error('[fetchRiddleSubmissions]', err);
    return { data: [], nextCursor: null, hasNextPage: false };
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

// ─── UserTasks ────────────────────────────────────────────────────────────────

export interface UserTasksData {
  objectId:           string;
  riddleOneSolved:    boolean;
  riddleTwoSolved:    boolean;
  riddleThreeSolved:  boolean;
  chainDrizzlets:     number;
  communityCode:      string | null;
}

/**
 * Given a list of tx digests (one per wallet), returns a map of
 * txDigest → UserTasks objectId by scanning objectChanges.
 */
export async function fetchUserTasksObjectIds(
  txDigests: string[]
): Promise<Record<string, string>> {
  if (txDigests.length === 0) return {};
  const results = await rpcCall<Array<{
    objectChanges?: Array<{
      type:        string;
      objectType?: string;
      objectId?:   string;
    }>;
  } | null>>('sui_multiGetTransactionBlocks', [
    txDigests,
    { showObjectChanges: true, showInput: false, showEffects: false, showEvents: false },
  ]);
  const map: Record<string, string> = {};
  for (let i = 0; i < txDigests.length; i++) {
    const changes = results[i]?.objectChanges ?? [];
    const found = changes.find(c => c.objectType?.includes('::tasks::UserTasks'));
    if (found?.objectId) map[txDigests[i]] = found.objectId;
  }
  return map;
}

/**
 * Given a list of UserTasks objectIds, returns a map of
 * objectId → UserTasksData with solved booleans and chain drizzlets.
 */
export async function fetchUserTasksObjects(
  objectIds: string[]
): Promise<Record<string, UserTasksData>> {
  if (objectIds.length === 0) return {};
  const results = await rpcCall<Array<{
    data?: {
      objectId: string;
      content?: {
        fields?: {
          riddle_one_answered?:   boolean;
          riddle_two_answered?:   boolean;
          riddle_three_answered?: boolean;
          drizzlets_earned?:                  string;
          used_community_participation_code?: number[];
        };
      };
    };
  } | null>>('sui_multiGetObjects', [
    objectIds,
    { showContent: true },
  ]);
  const map: Record<string, UserTasksData> = {};
  for (const result of results) {
    const d = result?.data;
    if (!d?.objectId) continue;
    const f = d.content?.fields;
    if (!f) continue;
    const codeBytes = (f as any).used_community_participation_code;
    const communityCode = Array.isArray(codeBytes) && codeBytes.length > 0
      ? String.fromCharCode(...codeBytes)
      : null;
    map[d.objectId] = {
      objectId:          d.objectId,
      riddleOneSolved:   f.riddle_one_answered   ?? false,
      riddleTwoSolved:   f.riddle_two_answered   ?? false,
      riddleThreeSolved: f.riddle_three_answered ?? false,
      chainDrizzlets:    Number(f.drizzlets_earned ?? 0),
      communityCode,
    };
  }
  return map;
}

