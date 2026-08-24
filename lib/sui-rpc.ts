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

const V3_PKG =
  process.env.IKA_V3_PACKAGE_ID ||
  '0x8349769aebae145032813465696e19958881857b762aba5411ff9cd07c8214e5';

const AIRDROP_PKG = '0x5a6ae39fd84a871e94c88badc7689debae22119461ba1581f674bfe50acc1271';
const AIRDROP_POOL_OBJECT = '0xf040974b98d008efccf0cee6cbaf0a456a76536601248d99fb9625d7fc8185e7';
const BUFFER_PKG = '0xfeecbb29272d34b78c402b894ea63b48cff4a717dafc96df8aa205edca89610c';

export const RIDDLE_DRIZZLETS_PER_SUBMISSION = 31;
export const SEASON_1_END_MS = 1787578510921; // Aug 24, 2026 13:35:11 UTC — InkSack Season 1 ended

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
  skipped?: Array<{ txDigest: string; rawInputs: unknown; rawTxns: unknown }>;
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
        effects?: {
          status?: { status: string };
        };
        transaction: {
          data: {
            transaction: {
              inputs?: Array<{
                type:       string;
                valueType?: string;
                value?:     string;
              }>;
              transactions?: Array<{
                MoveCall?: {
                  package?:   string;
                  module?:    string;
                  function?:  string;
                  arguments?: Array<{ Input?: number } | unknown>;
                };
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
        options: { showInput: true, showEffects: true },
      },
      cursor ? cursor.txDigest : null,
      100,
      false,
    ]);

    const data: RiddleSubmissionFlat[]  = [];
    const skipped: Array<{
      txDigest:  string;
      rawInputs: unknown;
      rawTxns:   unknown;
    }> = [];

    for (const tx of result.data) {
      // Skip failed transactions
      if (tx.effects?.status?.status !== 'success') continue;

      const txData     = tx.transaction?.data?.transaction;
      const inputs     = txData?.inputs       ?? [];
      const txns       = txData?.transactions ?? [];
      let riddleNumber = NaN;

      // ── Path 1: PTB — find exact MoveCall, read argument index ──────────
      const ptbMoveCall = txns.find(t =>
        t.MoveCall?.package  === V4_PKG &&
        t.MoveCall?.module   === 'tasks' &&
        t.MoveCall?.function === 'submit_riddle_answer'
      )?.MoveCall;

      if (ptbMoveCall) {
        const riddleArg  = ptbMoveCall.arguments?.[1] as { Input?: number } | undefined;
        const inputIndex = riddleArg?.Input;
        if (inputIndex !== undefined) {
          const val = inputs[inputIndex]?.value;
          if (val !== undefined) {
            const parsed = parseInt(String(val), 10);
            if (parsed >= 1 && parsed <= 3) riddleNumber = parsed;
          }
        }
      }

      // ── Path 2: Direct call — inputs[1] is the riddle number ────────────
      if (isNaN(riddleNumber)) {
        const val = inputs[1]?.value;
        if (val !== undefined) {
          const parsed = parseInt(String(val), 10);
          if (parsed >= 1 && parsed <= 3) riddleNumber = parsed;
        }
      }

      if (isNaN(riddleNumber)) {
        skipped.push({
          txDigest:  tx.digest,
          rawInputs: inputs,
          rawTxns:   txns,
        });
        continue;
      }

      data.push({
        txDigest:       tx.digest,
        timestampMs:    tx.timestampMs,
        wallet_address: tx.transaction.data.sender,
        riddle_number:  riddleNumber,
      });
    }

    const nextCursor: EventCursor | null = result.nextCursor
      ? { txDigest: result.nextCursor, eventSeq: '0' }
      : null;

    return { data, nextCursor, hasNextPage: result.hasNextPage, skipped };
  } catch (err) {
    console.error('[fetchRiddleSubmissions]', err);
    return { data: [], nextCursor: null, hasNextPage: false, skipped: [] };
  }
}

export async function fetchV3RiddleSubmissions(
  cursor: EventCursor | null = null
): Promise<EventPage<RiddleSubmissionFlat>> {
  try {
    const result = await rpcCall<{
      data: Array<{
        digest:      string;
        timestampMs: string;
        effects?: {
          status?: { status: string };
        };
        transaction: {
          data: {
            transaction: {
              inputs?: Array<{
                type:       string;
                valueType?: string;
                value?:     string;
              }>;
              transactions?: Array<{
                MoveCall?: {
                  package?:   string;
                  module?:    string;
                  function?:  string;
                  arguments?: Array<{ Input?: number } | unknown>;
                };
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
            package:  V3_PKG,
            module:   'tasks',
            function: 'submit_riddle_answer',
          },
        },
        options: { showInput: true, showEffects: true },
      },
      cursor ? cursor.txDigest : null,
      100,
      false,
    ]);

    const data: RiddleSubmissionFlat[]  = [];
    const skipped: Array<{
      txDigest:  string;
      rawInputs: unknown;
      rawTxns:   unknown;
    }> = [];

    for (const tx of result.data) {
      // Skip failed transactions
      if (tx.effects?.status?.status !== 'success') continue;

      const txData     = tx.transaction?.data?.transaction;
      const inputs     = txData?.inputs       ?? [];
      const txns       = txData?.transactions ?? [];
      let riddleNumber = NaN;

      // ── Path 1: PTB — find exact MoveCall, read argument index ──────────
      const ptbMoveCall = txns.find(t =>
        t.MoveCall?.package  === V3_PKG &&
        t.MoveCall?.module   === 'tasks' &&
        t.MoveCall?.function === 'submit_riddle_answer'
      )?.MoveCall;

      if (ptbMoveCall) {
        const riddleArg  = ptbMoveCall.arguments?.[1] as { Input?: number } | undefined;
        const inputIndex = riddleArg?.Input;
        if (inputIndex !== undefined) {
          const val = inputs[inputIndex]?.value;
          if (val !== undefined) {
            const parsed = parseInt(String(val), 10);
            if (parsed >= 1 && parsed <= 3) riddleNumber = parsed;
          }
        }
      }

      // ── Path 2: Direct call — inputs[1] is the riddle number ────────────
      if (isNaN(riddleNumber)) {
        const val = inputs[1]?.value;
        if (val !== undefined) {
          const parsed = parseInt(String(val), 10);
          if (parsed >= 1 && parsed <= 3) riddleNumber = parsed;
        }
      }

      if (isNaN(riddleNumber)) {
        skipped.push({
          txDigest:  tx.digest,
          rawInputs: inputs,
          rawTxns:   txns,
        });
        continue;
      }

      data.push({
        txDigest:       tx.digest,
        timestampMs:    tx.timestampMs,
        wallet_address: tx.transaction.data.sender,
        riddle_number:  riddleNumber,
      });
    }

    const nextCursor: EventCursor | null = result.nextCursor
      ? { txDigest: result.nextCursor, eventSeq: '0' }
      : null;

    return { data, nextCursor, hasNextPage: result.hasNextPage, skipped };
  } catch (err) {
    console.error('[fetchV3RiddleSubmissions]', err);
    return { data: [], nextCursor: null, hasNextPage: false, skipped: [] };
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
// ─── Airdrop Pool ─────────────────────────────────────────────────────────────

export interface AirdropPoolData {
  totalPool:  number;
  balance:    number;
  claimed:    number;
  pctClaimed: number;
}

export async function fetchAirdropPoolData(): Promise<AirdropPoolData | null> {
  try {
    const obj = await rpcCall<any>('sui_getObject', [
      AIRDROP_POOL_OBJECT,
      { showContent: true },
    ]);
    const fields = obj?.data?.content?.fields;
    if (!fields) return null;
    const totalPool = Number(fields.total_pool_amount) / 1e9;
    const balance   = Number(fields.balance)           / 1e9;
    const claimed   = totalPool - balance;
    return {
      totalPool,
      balance,
      claimed,
      pctClaimed: totalPool > 0 ? (claimed / totalPool) * 100 : 0,
    };
  } catch (err) {
    console.error('[fetchAirdropPoolData]', err);
    return null;
  }
}

// ─── Airdrop Prepare Recipients ───────────────────────────────────────────────

function decodeBcsAddresses(bytes: number[]): string[] {
  // BCS vector<address>: ULEB128 length + 32 bytes per address
  let offset = 0;
  let len = 0, shift = 0;
  while (offset < bytes.length) {
    const b = bytes[offset++];
    len |= (b & 0x7f) << shift;
    if ((b & 0x80) === 0) break;
    shift += 7;
  }
  const addresses: string[] = [];
  for (let i = 0; i < len; i++) {
    const chunk = bytes.slice(offset + i * 32, offset + (i + 1) * 32);
    addresses.push('0x' + chunk.map(b => b.toString(16).padStart(2, '0')).join(''));
  }
  return addresses;
}

export interface PrepareRecipientsFlat {
  wallet_address:    string;
  allocation_amount: number;
  sbt_required:      boolean;
  prepare_tx_digest: string;
}

export async function fetchPrepareRecipientsBatch(
  txDigests: string[]
): Promise<PrepareRecipientsFlat[]> {
  if (txDigests.length === 0) return [];
  const results = await rpcCall<Array<any | null>>(
    'sui_multiGetTransactionBlocks',
    [txDigests, { showInput: true, showEffects: false, showEvents: false }]
  );

  const out: PrepareRecipientsFlat[] = [];
  for (let i = 0; i < txDigests.length; i++) {
    const tx = results[i];
    if (!tx) continue;
    const inputs = tx.transaction?.data?.transaction?.inputs ?? [];

    // inputs[2] and inputs[3] are address byte chunks, inputs[4] amounts, inputs[5] bools
    // Detect layout: if inputs[3] is vector<u64> it's single-chunk layout
    const isSingleChunk = inputs[3]?.valueType === 'vector<u64>';

    let addresses: string[];
    let amounts:   string[];
    let sbts:      boolean[];

    if (isSingleChunk) {
      // Layout B: one address chunk
      const chunk: number[] = inputs[2]?.value ?? [];
      addresses = decodeBcsAddresses(chunk);
      amounts   = inputs[3]?.value ?? [];
      sbts      = inputs[4]?.value ?? [];
    } else {
      // Layout A: two address chunks merged via buffer helper
      const chunk1: number[] = inputs[2]?.value ?? [];
      const chunk2: number[] = inputs[3]?.value ?? [];
      addresses = [
        ...decodeBcsAddresses(chunk1),
        ...decodeBcsAddresses(chunk2),
      ];
      amounts = inputs[4]?.value ?? [];
      sbts    = inputs[5]?.value ?? [];
    }

    for (let j = 0; j < addresses.length; j++) {
      out.push({
        wallet_address:    addresses[j],
        allocation_amount: Number(amounts[j] ?? '0') / 1e9,
        sbt_required:      sbts[j] ?? false,
        prepare_tx_digest: txDigests[i],
      });
    }
  }
  return out;
}

// ─── Airdrop Claims ───────────────────────────────────────────────────────────

export interface AirdropClaimFlat {
  tx_digest:      string;
  wallet_address: string;
  claimed_amount: number;
  claim_type:     'claim' | 'claim_sbt';
  sbt_id:         string | null;
  claimed_at:     string;
}

export async function fetchAirdropClaims(
  claimType: 'claim' | 'claim_sbt',
  cursor: EventCursor | null = null
): Promise<EventPage<AirdropClaimFlat>> {
  try {
    const result = await rpcCall<{
      data: Array<{
        digest:          string;
        timestampMs:     string;
        effects?: { status?: { status: string } };
        transaction: {
          data: {
            transaction: {
              inputs?: Array<{ type: string; valueType?: string; value?: any }>;
            };
            sender: string;
          };
        };
        objectChanges?: Array<{ type: string; objectType?: string; objectId?: string }>;
      }>;
      nextCursor:  string | null;
      hasNextPage: boolean;
    }>('suix_queryTransactionBlocks', [
      {
        filter: {
          MoveFunction: {
            package:  AIRDROP_PKG,
            module:   'distribution',
            function: claimType,
          },
        },
        options: { showInput: true, showEffects: true, showObjectChanges: true },
      },
      cursor ? cursor.txDigest : null,
      100,
      false,
    ]);

    const data: AirdropClaimFlat[] = [];
    for (const tx of result.data) {
      if (tx.effects?.status?.status !== 'success') continue;
      const inputs = tx.transaction?.data?.transaction?.inputs ?? [];
      const claimedAmount = Number(inputs[2]?.value ?? '0') / 1e9;

      // Find SBT objectId from objectChanges for claim_sbt
      let sbtId: string | null = null;
      if (claimType === 'claim_sbt') {
        const sbtChange = (tx.objectChanges ?? []).find((c: any) =>
          c.objectType?.includes('::sbt::SoulBoundToken')
        );
        sbtId = sbtChange?.objectId ?? null;
      }

      data.push({
        tx_digest:      tx.digest,
        wallet_address: tx.transaction.data.sender,
        claimed_amount: claimedAmount,
        claim_type:     claimType,
        sbt_id:         sbtId,
        claimed_at:     new Date(parseInt(tx.timestampMs)).toISOString(),
      });
    }

    const nextCursor: EventCursor | null = result.nextCursor
      ? { txDigest: result.nextCursor, eventSeq: '0' }
      : null;

    return { data, nextCursor, hasNextPage: result.hasNextPage };
  } catch (err) {
    console.error(`[fetchAirdropClaims:${claimType}]`, err);
    return { data: [], nextCursor: null, hasNextPage: false };
  }
}
