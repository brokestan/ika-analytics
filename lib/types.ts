export type LockDuration = 0 | 1 | 7 | 30;

export interface WalletRecord {
  id: string; address: string; first_seen_at: string;
  last_active_at: string; total_drizzlets: number;
  ika_locked: number; isui_locked: number;
  active_locks: number; created_at: string; updated_at: string;
}

export interface LockRecord {
  id: string; wallet_address: string; tx_digest: string;
  lock_duration: LockDuration; ika_amount: number; locked_at: string;
  unlocked_at: string | null; is_active: boolean;
  drizzlets_earned: number; nft_id: string | null;
  created_at: string; updated_at: string;
}

export interface DashboardMetrics {
  total_ika_staked: number; total_isui_staked: number;
  total_locked_nfts: number; total_unlocked_nfts: number;
  total_staking_nfts: number; unique_staking_wallets: number;
  total_drizzlets_earned: number; forecast_drizzlets_30d: number;
  forecast_drizzlets_60d: number; forecast_drizzlets_season: number;
  last_indexed_at: string | null;
}

export interface LeaderboardEntry {
  rank: number; wallet_address: string; ika_locked: number;
  isui_locked: number; active_locks: number; total_drizzlets: number;
}

export interface ApiResponse<T> {
  data: T | null; error: string | null; cached_at?: string;
}
