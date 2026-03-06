export type LockDuration = 0 | 1 | 7 | 30;
export type AssetType = 'ika' | 'isui';

export interface WalletRecord {
  id: string;
  address: string;
  first_seen_at: string;
  last_active_at: string;
  total_drizzlets: number;
  ika_locked: number;
  isui_locked: number;
  active_locks: number;
  created_at: string;
  updated_at: string;
}

export interface LockRecord {
  id: string;
  wallet_address: string;
  tx_digest: string;
  asset_type: AssetType;
  lock_duration: LockDuration;
  ika_amount: number;
  isui_amount: number;
  locked_at: string;
  unlocked_at: string | null;
  is_active: boolean;
  drizzlets_earned: number;
  state_time_ts: string;
  created_at: string;
  updated_at: string;
}

export interface DrizzletRecord {
  id: string;
  wallet_address: string;
  source: 'ika_lock' | 'isui_lock' | 'riddle' | 'unlock';
  amount: number;
  reference_id: string | null;
  earned_at: string;
  created_at: string;
}

export interface RiddlePoolRecord {
  id: string;
  pool_index: number;
  amount: number;
  raw_amount: string;
  fetched_at: string;
  created_at: string;
}

export interface DashboardMetrics {
  total_ika_staked: number;
  total_isui_staked: number;
  total_locked_nfts: number;
  total_unlocked_nfts: number;
  total_staking_nfts: number;
  unique_staking_wallets: number;
  total_drizzlets_earned: number;
  forecast_drizzlets_30d: number;
  forecast_drizzlets_60d: number;
  forecast_drizzlets_season: number;
  last_indexed_at: string | null;
}

export interface RiddlePoolData {
  pool1: number;
  pool2: number;
  pool3: number;
  total: number;
  fetched_at: string | null;
}

export interface DrizzletDistribution {
  locked_ika_rewards: number;
  isui_rewards: number;
  unlocked_drizzlets: number;
  riddle_rewards: number;
}

export interface LockDistributionItem {
  duration: LockDuration;
  label: string;
  percentage: number;
  total_nfts: number;
  total_ika: number;
  rate: number;
}

export interface LeaderboardEntry {
  rank: number;
  wallet_address: string;
  ika_locked: number;
  isui_locked: number;
  active_locks: number;
  total_drizzlets: number;
}

export interface LeaderboardResponse {
  data: LeaderboardEntry[];
  total: number;
  page: number;
  per_page: number;
}

export interface ApiResponse<T> {
  data: T | null;
  error: string | null;
  cached_at?: string;
}

export interface SuiObject {
  objectId: string;
  version: string;
  digest: string;
  content?: {
    dataType: string;
    type: string;
    hasPublicTransfer: boolean;
    fields: Record<string, unknown>;
  };
}

// ─── Real chain event shapes ──────────────────────────────────────────────────

export interface StakedIkaLockedFields {
  account: string;
  staked_ika_balance: string;  // raw — divide by 1e9
  state_time_ts: string;       // ms timestamp
}

export interface StakedIkaUnlockedFields {
  account: string;
  staked_ika_balance: string;
  drizzlets_earned: string;    // raw count — NO 1e9 division
  state_time_ts: string;
  unlock_time_ts: string;
}

// iSUI events — field names mirror IKA pattern with isui_balance
export interface ISUILockedFields {
  account: string;
  isui_balance: string;        // raw — divide by 1e9
  state_time_ts: string;
}

export interface ISUIUnlockedFields {
  account: string;
  isui_balance: string;
  drizzlets_earned: string;    // raw count — NO 1e9 division
  state_time_ts: string;
  unlock_time_ts: string;
}
