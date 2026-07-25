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
  // NOTE: this exact multi-alias batching shape hasn't been tried against
  // the real endpoint yet — worth a small test (2-3 digests) before trusting
  // it at full batch size. If the provider rejects a large batch, fall back
  // to chunking into smaller groups (e.g. 10 at a time) or sequential calls.
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
