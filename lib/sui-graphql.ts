/*
 * lib/sui-graphql.ts
 *
 * GraphQL replacement for the IKA lock/unlock pieces of lib/sui-rpc.ts.
 * Drop this in alongside the existing file — nothing here touches or
 * imports anything that writes to Supabase. route.ts decides which
 * implementation to call; this file only fetches and shapes chain data.
 *
 * Reuses the exact same exported types (EventCursor, EventPage<T>,
 * LockEventFlat, UnlockEventFlat) from sui-rpc.ts so this is a drop-in
 * swap for route.ts — only the import source changes for these two
 * functions, nothing about how route.ts calls or merges them.
 */

import type {
  EventCursor,
  EventPage,
  LockEventFlat,
  UnlockEventFlat,
  ISUILockEventFlat,
  ISUIUnlockEventFlat,
  RiddleSubmissionFlat,
  AirdropClaimFlat,
} from './sui-rpc';
import type { LockDuration } from './types';

const GRAPHQL_URL = process.env.SUI_GRAPHQL_URL || 'https://graphql.mainnet.sui.io/graphql';

const PKG =
  process.env.IKA_PACKAGE_ID ||
  '0x7de6bc92a5b7e07d09faecbff30f4c0ef751b97cafbd29fef8898a822a325d27';

const EVENT_IKA_LOCK   = `${PKG}::event_wrapper::Event<${PKG}::tasks::StakedIkaLocked>`;
const EVENT_IKA_UNLOCK = `${PKG}::event_wrapper::Event<${PKG}::tasks::StakedIkaUnlocked>`;

// Same package as IKA — confirmed via the playground, not a separate deployment.
const EVENT_ISUI_LOCK   = `${PKG}::event_wrapper::Event<${PKG}::tasks::ISuiLocked>`;
const EVENT_ISUI_UNLOCK = `${PKG}::event_wrapper::Event<${PKG}::tasks::ISuiUnlocked>`;

// Riddle submissions run against the newer V4 contract — a distinct package
// from the main tasks PKG above (confirmed: this is what your V3 stream,
// which we're deliberately not migrating since that contract is paused,
// used to point at a different package entirely).
const V4_PKG =
  process.env.IKA_V4_PACKAGE_ID ||
  '0x765307507478ca630ddc0c44ab3bb9e83c3aa98aea2777a4f0aea0ade4a853f8';
const RIDDLE_FUNCTION = `${V4_PKG}::tasks::submit_riddle_answer`;

// Airdrop package — hardcoded in the original file too, no env override there.
const AIRDROP_PKG = '0x5a6ae39fd84a871e94c88badc7689debae22119461ba1581f674bfe50acc1271';

// Confirmed via the playground (the coinType.repr on the real balance change
// for a known claim, cross-checked against the stored claimed_amount).
const IKA_COIN_TYPE = '0x7262fb2f7a3a14c888c438a3cd9b912469a58cf60f367352c46584262e8299aa::ika::IKA';

// Free overlap-safety margin below the recorded checkpoint. Overlap costs
// nothing: `locks.tx_digest` is unique-constrained, and unlock updates are
// naturally no-ops once is_active is already false. A gap is the only real
// risk, so we deliberately look further back than the exact number.
const CHECKPOINT_SAFETY_BUFFER = 100;

// ─── GraphQL transport ──────────────────────────────────────────────────────

async function graphqlCall<T>(query: string): Promise<T> {
  const res = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
    cache: 'no-store' as RequestInit['cache'],
  });
  if (!res.ok) throw new Error(`GraphQL HTTP ${res.status}`);
  const json = await res.json() as { data?: T; errors?: Array<{ message: string }> };
  if (json.errors?.length) throw new Error(`GraphQL error: ${json.errors.map(e => e.message).join('; ')}`);
  if (json.data === undefined) throw new Error('GraphQL: no data returned');
  return json.data;
}

// ─── Generic paginated event fetch (shared by lock + unlock) ──────────────

interface RawEventNode {
  transaction: { digest: string };
  timestamp: string;
  sender: { address: string } | null;
  contents: { json: any };
}
interface RawEventsResponse {
  events: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: RawEventNode[];
  };
}

/**
 * cursor.eventSeq holds the GraphQL opaque pagination cursor once this
 * stream has made its first GraphQL call. cursor.txDigest is carried along
 * purely as a human-readable audit trail (so `indexer_checkpoints` still
 * shows a real digest you can paste into Suivision) — it is never fed back
 * into the query.
 *
 * bootstrapCheckpoint should be `indexer_checkpoints.last_checkpoint_number`
 * for this stream — the number captured while JSON-RPC still worked. It's
 * passed on every call, forever, as a permanent floor. Once the real `after`
 * cursor takes over this is redundant, but it's a safety net if a cursor
 * is ever lost or reset — the stream can never accidentally crawl earlier
 * than this floor.
 */
async function fetchEventStreamPage(
  eventType: string,
  cursor: EventCursor | null,
  bootstrapCheckpoint: number,
): Promise<{ nodes: RawEventNode[]; nextCursor: EventCursor | null; hasNextPage: boolean }> {
  const floor = Math.max(bootstrapCheckpoint - CHECKPOINT_SAFETY_BUFFER, 0);
  const afterClause = cursor?.eventSeq ? `, after: "${cursor.eventSeq}"` : '';

  const query = `
    query {
      events(filter: { type: "${eventType}", afterCheckpoint: ${floor} }, first: 50${afterClause}) {
        pageInfo { hasNextPage endCursor }
        nodes {
          transaction { digest }
          timestamp
          sender { address }
          contents { json }
        }
      }
    }
  `;

  const data = await graphqlCall<RawEventsResponse>(query);
  const nodes = data.events.nodes;
  const nextCursor: EventCursor | null = data.events.pageInfo.hasNextPage
    ? {
        txDigest: nodes.length ? nodes[nodes.length - 1].transaction.digest : (cursor?.txDigest ?? ''),
        eventSeq: data.events.pageInfo.endCursor ?? '',
      }
    : null;

  return { nodes, nextCursor, hasNextPage: data.events.pageInfo.hasNextPage };
}

function tsFromIso(iso: string): string {
  return String(new Date(iso).getTime());
}

// ─── IKA Lock Events ────────────────────────────────────────────────────────

export async function fetchLockStakeEventsGraphQL(
  cursor: EventCursor | null,
  bootstrapCheckpoint: number,
): Promise<EventPage<LockEventFlat>> {
  try {
    const { nodes, nextCursor, hasNextPage } =
      await fetchEventStreamPage(EVENT_IKA_LOCK, cursor, bootstrapCheckpoint);

    const data: LockEventFlat[] = nodes.map(n => ({
      txDigest:           n.transaction.digest,
      timestampMs:        tsFromIso(n.timestamp),
      account:            n.contents.json.pos0.account,
      staked_ika_balance: n.contents.json.pos0.staked_ika_balance,
      state_time_ts:      n.contents.json.pos0.state_time_ts,
      // Filled in afterward by fetchDurationsForBatchGraphQL — same
      // two-step pattern as the JSON-RPC version already uses.
      lock_duration: 0 as LockDuration,
    }));

    return { data, nextCursor, hasNextPage };
  } catch (err) {
    console.error('[fetchLockStakeEventsGraphQL]', err);
    return { data: [], nextCursor: cursor, hasNextPage: false };
  }
}

// ─── IKA Unlock Events ──────────────────────────────────────────────────────

export async function fetchUnlockEventsGraphQL(
  cursor: EventCursor | null,
  bootstrapCheckpoint: number,
): Promise<EventPage<UnlockEventFlat>> {
  try {
    const { nodes, nextCursor, hasNextPage } =
      await fetchEventStreamPage(EVENT_IKA_UNLOCK, cursor, bootstrapCheckpoint);

    const data: UnlockEventFlat[] = nodes.map(n => ({
      txDigest:           n.transaction.digest,
      timestampMs:        tsFromIso(n.timestamp),
      account:            n.contents.json.pos0.account,
      staked_ika_balance: n.contents.json.pos0.staked_ika_balance,
      drizzlets_earned:   n.contents.json.pos0.drizzlets_earned,
      state_time_ts:      n.contents.json.pos0.state_time_ts,
      unlock_time_ts:     n.contents.json.pos0.unlock_time_ts,
    }));

    return { data, nextCursor, hasNextPage };
  } catch (err) {
    console.error('[fetchUnlockEventsGraphQL]', err);
    return { data: [], nextCursor: cursor, hasNextPage: false };
  }
}

// ─── iSUI Lock Events ───────────────────────────────────────────────────────
// Same shape as IKA locks — confirmed against real data: on-chain field is
// `i_sui_balance` (with the extra underscore), but the flat type your app
// already uses calls it `isui_balance`. That rename is the only real
// difference from the IKA version below.

export async function fetchISUILockEventsGraphQL(
  cursor: EventCursor | null,
  bootstrapCheckpoint: number,
): Promise<EventPage<ISUILockEventFlat>> {
  try {
    const { nodes, nextCursor, hasNextPage } =
      await fetchEventStreamPage(EVENT_ISUI_LOCK, cursor, bootstrapCheckpoint);

    const data: ISUILockEventFlat[] = nodes.map(n => ({
      txDigest:      n.transaction.digest,
      timestampMs:   tsFromIso(n.timestamp),
      account:       n.contents.json.pos0.account,
      isui_balance:  n.contents.json.pos0.i_sui_balance, // renamed on the way in
      state_time_ts: n.contents.json.pos0.state_time_ts,
    }));

    return { data, nextCursor, hasNextPage };
  } catch (err) {
    console.error('[fetchISUILockEventsGraphQL]', err);
    return { data: [], nextCursor: cursor, hasNextPage: false };
  }
}

// ─── iSUI Unlock Events ─────────────────────────────────────────────────────

export async function fetchISUIUnlockEventsGraphQL(
  cursor: EventCursor | null,
  bootstrapCheckpoint: number,
): Promise<EventPage<ISUIUnlockEventFlat>> {
  try {
    const { nodes, nextCursor, hasNextPage } =
      await fetchEventStreamPage(EVENT_ISUI_UNLOCK, cursor, bootstrapCheckpoint);

    const data: ISUIUnlockEventFlat[] = nodes.map(n => ({
      txDigest:          n.transaction.digest,
      timestampMs:       tsFromIso(n.timestamp),
      account:           n.contents.json.pos0.account,
      isui_balance:      n.contents.json.pos0.i_sui_balance, // renamed on the way in
      drizzlets_earned:  n.contents.json.pos0.drizzlets_earned,
      state_time_ts:     n.contents.json.pos0.state_time_ts,
      unlock_time_ts:    n.contents.json.pos0.unlock_time_ts,
    }));

    return { data, nextCursor, hasNextPage };
  } catch (err) {
    console.error('[fetchISUIUnlockEventsGraphQL]', err);
    return { data: [], nextCursor: cursor, hasNextPage: false };
  }
}

// ─── Lock Duration Enrichment ───────────────────────────────────────────────
// Mirrors fetchDurationsForBatch exactly: scan each transaction's move-call
// inputs for the one value matching 1, 7, or 30 (the only valid durations).
// Confirmed against real data — position varies by call shape, but matching
// by *value* is what the original code already relies on, so this carries
// that same robustness over unchanged.

interface RawTxKindResponse {
  [alias: string]: {
    kind?: {
      inputs?: { nodes: Array<{ __typename: string; json?: string }> };
    };
  };
}

export async function fetchDurationsForBatchGraphQL(
  txDigests: string[]
): Promise<Record<string, LockDuration>> {
  if (txDigests.length === 0) return {};
  const map: Record<string, LockDuration> = {};
  const aliasFor = (i: number) => `tx${i}`;

  // One aliased root field per digest, batched into a single request —
  // same intent as sui_multiGetTransactionBlocks doing them all at once.
  // Confirmed working at small batch size (2-3 digests) via the playground.
  // If a large batch ever gets rejected by the provider, chunk into smaller
  // groups (e.g. 10 at a time) rather than one giant request.
  const query = `
    query {
      ${txDigests.map((d, i) => `
        ${aliasFor(i)}: transaction(digest: "${d}") {
          kind {
            __typename
            ... on ProgrammableTransaction {
              inputs { nodes { __typename ... on MoveValue { json } } }
            }
          }
        }
      `).join('\n')}
    }
  `;

  try {
    const data = await graphqlCall<RawTxKindResponse>(query);
    txDigests.forEach((digest, i) => {
      const inputNodes = data[aliasFor(i)]?.kind?.inputs?.nodes ?? [];
      const match = inputNodes.find(n => n.json === '1' || n.json === '7' || n.json === '30');
      const raw = match ? parseInt(match.json as string, 10) : 0;
      map[digest] = (raw === 1 ? 1 : raw === 7 ? 7 : raw === 30 ? 30 : 0) as LockDuration;
    });
  } catch (err) {
    console.error('[fetchDurationsForBatchGraphQL]', err);
    // Digests left out of the map fall back to duration 0 in route.ts,
    // same behavior as the JSON-RPC version on a failed lookup.
  }

  return map;
}

// ─── MF Squid Maiden Mints ──────────────────────────────────────────────────

const MFSM_EVENT_TYPE =
  '0x3533437eabe66f05207aec78857efad86f42c2be84e2bbd63692c7c37fd349fb::mf_squid_maiden::MfSquidMaidenMinted';

// Confirmed via the playground: unlike lock/unlock, this event's contents
// are NOT wrapped in pos0 — it's a flat { id: "0x..." }. The wallet also
// isn't in the event payload at all here, so it comes from the
// transaction's sender instead.
export async function fetchMfSquidMaidenMintEventsGraphQL(
  cursor: EventCursor | null,
  bootstrapCheckpoint: number,
): Promise<EventPage<{ txDigest: string; timestampMs: string; wallet: string; nft_id: string }>> {
  try {
    const { nodes, nextCursor, hasNextPage } =
      await fetchEventStreamPage(MFSM_EVENT_TYPE, cursor, bootstrapCheckpoint);

    const data = nodes.map(n => ({
      txDigest:    n.transaction.digest,
      timestampMs: tsFromIso(n.timestamp),
      wallet:      n.sender?.address ?? '',
      nft_id:      n.contents.json.id,
    }));

    return { data, nextCursor, hasNextPage };
  } catch (err) {
    console.error('[fetchMfSquidMaidenMintEventsGraphQL]', err);
    return { data: [], nextCursor: cursor, hasNextPage: false };
  }
}

// ─── ika_chan_nft_id lookup (NFTUpdated event within the mint transaction) ──
// Confirmed via the playground: the real package for this module is
// 0x1627e933e2546d324ef1095151782770fb9ea959f9eb01184b8802553b937999 — a
// distinct package from both the tasks package and the ika_chan_nft type's
// own package. Each mint transaction carries a handful of events (we saw 4
// in testing), so first: 20 per transaction is generous headroom, not a
// tight limit — if a future transaction shape has more, raise this rather
// than assume it's always small.
interface RawTxEventsResponse {
  [alias: string]: {
    effects?: {
      events?: { nodes: Array<{ contents: { type: { repr: string }; json: any } }> };
    };
  };
}

export async function fetchTransactionEventsInBatchGraphQL(
  txDigests: string[]
): Promise<Record<string, string>> {
  if (txDigests.length === 0) return {};
  const map: Record<string, string> = {};
  const aliasFor = (i: number) => `tx${i}`;

  const query = `
    query {
      ${txDigests.map((d, i) => `
        ${aliasFor(i)}: transaction(digest: "${d}") {
          effects {
            events(first: 20) {
              nodes { contents { type { repr } json } }
            }
          }
        }
      `).join('\n')}
    }
  `;

  try {
    const data = await graphqlCall<RawTxEventsResponse>(query);
    txDigests.forEach((digest, i) => {
      const eventNodes = data[aliasFor(i)]?.effects?.events?.nodes ?? [];
      const nftUpdated = eventNodes.find(e => e.contents.type.repr.includes('::ika_chan_updater::NFTUpdated'));
      if (nftUpdated?.contents.json?.id) {
        map[digest] = nftUpdated.contents.json.id;
      }
    });
  } catch (err) {
    console.error('[fetchTransactionEventsInBatchGraphQL]', err);
    // Digests left out of the map simply get no ika_chan_nft_id this run,
    // same fallback behavior as the JSON-RPC version.
  }

  return map;
}

// ─── ika_chan NFT object read (level + rarity for the drizzlet formula) ────
// Confirmed via the playground: contents.json.metadata.{level,rarity} is a
// direct, flat match for what fetchIkaChanNftObjects already reads via
// content.fields.metadata.fields.{level,rarity} on JSON-RPC — same field
// names, one less layer of nesting, no renaming needed.

interface RawObjectsResponse {
  [alias: string]: {
    asMoveObject?: { contents?: { json?: { metadata?: { level?: number; rarity?: string } } } };
  };
}

export async function fetchIkaChanNftObjectsGraphQL(
  objectIds: string[]
): Promise<Record<string, { level: number; rarity: string }>> {
  if (objectIds.length === 0) return {};
  const map: Record<string, { level: number; rarity: string }> = {};
  const aliasFor = (i: number) => `obj${i}`;

  const query = `
    query {
      ${objectIds.map((id, i) => `
        ${aliasFor(i)}: object(address: "${id}") {
          asMoveObject { contents { json } }
        }
      `).join('\n')}
    }
  `;

  try {
    const data = await graphqlCall<RawObjectsResponse>(query);
    objectIds.forEach((id, i) => {
      const metadata = data[aliasFor(i)]?.asMoveObject?.contents?.json?.metadata;
      if (metadata?.level !== undefined && metadata?.rarity) {
        map[id] = { level: Number(metadata.level), rarity: String(metadata.rarity) };
      }
    });
  } catch (err) {
    console.error('[fetchIkaChanNftObjectsGraphQL]', err);
  }

  return map;
}

// ─── Generic paginated transaction-filter fetch ────────────────────────────
// Shared by riddle submissions and both airdrop claim types — all three
// filter on a specific Move function rather than an event type, confirmed
// to support the same afterCheckpoint floor mechanism as events do.

interface RawTxNode {
  digest: string;
  sender: { address: string } | null;
  effects: {
    status: string; // "SUCCESS" / "FAILURE" — uppercase, NOT JSON-RPC's lowercase "success"
    timestamp: string;
    balanceChanges: { nodes: Array<{ amount: string; coinType: { repr: string } }> } | null;
    objectChanges: {
      nodes: Array<{
        address: string;
        outputState: { asMoveObject?: { contents?: { type?: { repr: string } } } } | null;
      }>;
    } | null;
  };
  kind: {
    __typename: string;
    inputs?: { nodes: Array<{ __typename: string; json?: string }> };
  };
}
interface RawTxsResponse {
  transactions: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: RawTxNode[];
  };
}

async function fetchTxStreamPage(
  functionFilter: string,
  cursor: EventCursor | null,
  bootstrapCheckpoint: number,
): Promise<{ nodes: RawTxNode[]; nextCursor: EventCursor | null; hasNextPage: boolean }> {
  const floor = Math.max(bootstrapCheckpoint - CHECKPOINT_SAFETY_BUFFER, 0);
  const afterClause = cursor?.eventSeq ? `, after: "${cursor.eventSeq}"` : '';

  const query = `
    query {
      transactions(filter: { function: "${functionFilter}", afterCheckpoint: ${floor} }, first: 50${afterClause}) {
        pageInfo { hasNextPage endCursor }
        nodes {
          digest
          sender { address }
          effects {
            status
            timestamp
            balanceChanges { nodes { amount coinType { repr } } }
            objectChanges { nodes { address outputState { asMoveObject { contents { type { repr } } } } } }
          }
          kind {
            __typename
            ... on ProgrammableTransaction {
              inputs { nodes { __typename ... on MoveValue { json } } }
            }
          }
        }
      }
    }
  `;

  const data = await graphqlCall<RawTxsResponse>(query);
  const nodes = data.transactions.nodes;
  const nextCursor: EventCursor | null = data.transactions.pageInfo.hasNextPage
    ? {
        txDigest: nodes.length ? nodes[nodes.length - 1].digest : (cursor?.txDigest ?? ''),
        eventSeq: data.transactions.pageInfo.endCursor ?? '',
      }
    : null;

  return { nodes, nextCursor, hasNextPage: data.transactions.pageInfo.hasNextPage };
}

// ─── Riddle Submissions ─────────────────────────────────────────────────────
// CRITICAL: a wrong riddle answer aborts the on-chain call — it never
// produces a row at all, in either the JSON-RPC or GraphQL version. The
// effects.status === 'SUCCESS' check below (uppercase!) IS the correctness
// gate for the entire stream. Get this comparison wrong and either every
// genuinely correct submission silently vanishes, or (if inverted) wrong
// answers start getting counted. This is the single most important line
// in this function.

export async function fetchRiddleSubmissionsGraphQL(
  cursor: EventCursor | null,
  bootstrapCheckpoint: number,
): Promise<EventPage<RiddleSubmissionFlat>> {
  try {
    const { nodes, nextCursor, hasNextPage } =
      await fetchTxStreamPage(RIDDLE_FUNCTION, cursor, bootstrapCheckpoint);

    const data: RiddleSubmissionFlat[] = [];
    for (const tx of nodes) {
      if (tx.effects.status !== 'SUCCESS') continue;

      // Confirmed via the playground: the riddle number sits at inputs[1]
      // as a MoveValue. Bounds-checked to 1-3, same as the JSON-RPC
      // version, so anything unexpected gets skipped rather than stored.
      const inputNodes = tx.kind.inputs?.nodes ?? [];
      const raw = inputNodes[1]?.json;
      const riddleNumber = raw !== undefined ? parseInt(raw, 10) : NaN;
      if (isNaN(riddleNumber) || riddleNumber < 1 || riddleNumber > 3) continue;

      data.push({
        txDigest:       tx.digest,
        timestampMs:    tsFromIso(tx.effects.timestamp),
        wallet_address: tx.sender?.address ?? '',
        riddle_number:  riddleNumber,
      });
    }

    return { data, nextCursor, hasNextPage };
  } catch (err) {
    console.error('[fetchRiddleSubmissionsGraphQL]', err);
    return { data: [], nextCursor: cursor, hasNextPage: false };
  }
}

// ─── Airdrop Claims (claim + claim_sbt) ─────────────────────────────────────
// Same SUCCESS/success gotcha as riddle submissions applies here too.
//
// claimed_amount comes from balanceChanges filtered to the IKA coin type,
// not from reading a fixed input position like the JSON-RPC version does.
// Confirmed via the playground to match the stored value exactly, and it's
// actually more robust than the original: a balance change is always
// per-transaction by definition, so there's no risk of accidentally reading
// a cumulative total (which some of the contract's own object fields are).

export async function fetchAirdropClaimsGraphQL(
  claimType: 'claim' | 'claim_sbt',
  cursor: EventCursor | null,
  bootstrapCheckpoint: number,
): Promise<EventPage<AirdropClaimFlat>> {
  const functionFilter = `${AIRDROP_PKG}::distribution::${claimType}`;
  try {
    const { nodes, nextCursor, hasNextPage } =
      await fetchTxStreamPage(functionFilter, cursor, bootstrapCheckpoint);

    const data: AirdropClaimFlat[] = [];
    for (const tx of nodes) {
      if (tx.effects.status !== 'SUCCESS') continue;

      const ikaChange = (tx.effects.balanceChanges?.nodes ?? [])
        .find(b => b.coinType.repr === IKA_COIN_TYPE);
      const claimedAmount = ikaChange ? Number(ikaChange.amount) / 1e9 : 0;

      let sbtId: string | null = null;
      if (claimType === 'claim_sbt') {
        const sbtChange = (tx.effects.objectChanges?.nodes ?? [])
          .find(c => c.outputState?.asMoveObject?.contents?.type?.repr.includes('::sbt::SoulBoundToken'));
        sbtId = sbtChange?.address ?? null;
      }

      data.push({
        tx_digest:      tx.digest,
        wallet_address: tx.sender?.address ?? '',
        claimed_amount: claimedAmount,
        claim_type:     claimType,
        sbt_id:         sbtId,
        // effects.timestamp is already ISO-8601 from GraphQL, unlike
        // JSON-RPC's raw timestampMs — no conversion needed here.
        claimed_at: tx.effects.timestamp,
      });
    }

    return { data, nextCursor, hasNextPage };
  } catch (err) {
    console.error(`[fetchAirdropClaimsGraphQL:${claimType}]`, err);
    return { data: [], nextCursor: cursor, hasNextPage: false };
  }
}
// ─── Riddle Pool (stateless object read — no checkpoint, always current state) ─
// Confirmed via the playground: contents.json.{riddle_one_pool,two,three}_pool
// are flat, raw numbers directly on the Tasks shared object — no 1e9 division,
// same as the JSON-RPC version.

const RIDDLE_POOL_OBJECT =
  process.env.RIDDLE_POOL_OBJECT_ID ||
  '0x92c105c5cf5713a751ee18e7a007fbb238ae242b7234cf1ee25be51974eef334';

export interface RiddlePoolFields {
  pool1: number;
  pool2: number;
  pool3: number;
}

export async function fetchRiddlePoolGraphQL(): Promise<RiddlePoolFields | null> {
  try {
    const query = `
      query {
        object(address: "${RIDDLE_POOL_OBJECT}") {
          asMoveObject { contents { json } }
        }
      }
    `;
    const data = await graphqlCall<{ object: { asMoveObject?: { contents?: { json?: any } } } }>(query);
    const fields = data.object?.asMoveObject?.contents?.json;
    if (!fields) return null;
    return {
      pool1: Number(fields.riddle_one_pool   ?? 0),
      pool2: Number(fields.riddle_two_pool   ?? 0),
      pool3: Number(fields.riddle_three_pool ?? 0),
    };
  } catch (err) {
    console.error('[fetchRiddlePoolGraphQL]', err);
    return null;
  }
}

// ─── UserTasks lookup + object read (stateless — no checkpoint) ──────────────
// fetchUserTasksObjectIdsGraphQL mirrors the airdrop SBT / mfsm ika_chan
// lookups exactly: given transactions you already have digests for (from
// riddle_submissions), find the UserTasks object each one touched via
// objectChanges. No `first:` argument on objectChanges here — deliberately
// matching the exact shape already proven in the airdrop SBT test rather
// than introducing an untested variant.

export interface UserTasksData {
  objectId:           string;
  riddleOneSolved:    boolean;
  riddleTwoSolved:    boolean;
  riddleThreeSolved:  boolean;
  chainDrizzlets:     number;
  communityCode:      string | null;
}

interface RawObjectChangesResponse {
  [alias: string]: {
    effects?: {
      objectChanges?: {
        nodes: Array<{
          address: string;
          outputState: { asMoveObject?: { contents?: { type?: { repr: string } } } } | null;
        }>;
      };
    };
  };
}

export async function fetchUserTasksObjectIdsGraphQL(
  txDigests: string[]
): Promise<Record<string, string>> {
  if (txDigests.length === 0) return {};
  const map: Record<string, string> = {};
  const aliasFor = (i: number) => `tx${i}`;

  const query = `
    query {
      ${txDigests.map((d, i) => `
        ${aliasFor(i)}: transaction(digest: "${d}") {
          effects {
            objectChanges {
              nodes { address outputState { asMoveObject { contents { type { repr } } } } }
            }
          }
        }
      `).join('\n')}
    }
  `;

  try {
    const data = await graphqlCall<RawObjectChangesResponse>(query);
    txDigests.forEach((digest, i) => {
      const changeNodes = data[aliasFor(i)]?.effects?.objectChanges?.nodes ?? [];
      const found = changeNodes.find(c =>
        c.outputState?.asMoveObject?.contents?.type?.repr.includes('::tasks::UserTasks')
      );
      if (found?.address) map[digest] = found.address;
    });
  } catch (err) {
    console.error('[fetchUserTasksObjectIdsGraphQL]', err);
  }

  return map;
}

interface RawUserTasksObjectsResponse {
  [alias: string]: {
    asMoveObject?: {
      contents?: {
        json?: {
          riddle_one_answered?:   boolean;
          riddle_two_answered?:   boolean;
          riddle_three_answered?: boolean;
          drizzlets_earned?:      string;
          used_community_participation_code?: string;
        };
      };
    };
  };
}

export async function fetchUserTasksObjectsGraphQL(
  objectIds: string[]
): Promise<Record<string, UserTasksData>> {
  if (objectIds.length === 0) return {};
  const map: Record<string, UserTasksData> = {};
  const aliasFor = (i: number) => `obj${i}`;

  const query = `
    query {
      ${objectIds.map((id, i) => `
        ${aliasFor(i)}: object(address: "${id}") {
          asMoveObject { contents { json } }
        }
      `).join('\n')}
    }
  `;

  try {
    const data = await graphqlCall<RawUserTasksObjectsResponse>(query);
    objectIds.forEach((id, i) => {
      const fields = data[aliasFor(i)]?.asMoveObject?.contents?.json;
      if (!fields) return;
      // GraphQL already gives us a decoded string here — unlike JSON-RPC,
      // which returns a raw byte array needing String.fromCharCode(...).
      const code = fields.used_community_participation_code;
      map[id] = {
        objectId:          id,
        riddleOneSolved:   fields.riddle_one_answered   ?? false,
        riddleTwoSolved:   fields.riddle_two_answered   ?? false,
        riddleThreeSolved: fields.riddle_three_answered ?? false,
        chainDrizzlets:    Number(fields.drizzlets_earned ?? 0),
        communityCode:     code && code.length > 0 ? code : null,
      };
    });
  } catch (err) {
    console.error('[fetchUserTasksObjectsGraphQL]', err);
  }

  return map;
}
