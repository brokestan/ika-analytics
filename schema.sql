-- ═══════════════════════════════════════════════════════════════════════
-- IKA Analytics - Supabase Database Schema
-- Run this in Supabase SQL Editor to set up all tables
-- ═══════════════════════════════════════════════════════════════════════

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── wallets ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wallets (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  address          TEXT UNIQUE NOT NULL,
  first_seen_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_active_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  total_drizzlets  NUMERIC(20, 4) NOT NULL DEFAULT 0,
  ika_locked       NUMERIC(20, 9) NOT NULL DEFAULT 0,
  isui_locked      NUMERIC(20, 9) NOT NULL DEFAULT 0,
  active_locks     INTEGER NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS wallets_total_drizzlets_idx ON wallets (total_drizzlets DESC);
CREATE INDEX IF NOT EXISTS wallets_address_idx ON wallets (address);

-- ─── locks (IKA staking NFTs) ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS locks (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  wallet_address  TEXT NOT NULL REFERENCES wallets(address) ON DELETE CASCADE,
  tx_digest       TEXT UNIQUE NOT NULL,
  lock_duration   INTEGER NOT NULL CHECK (lock_duration IN (0, 1, 7, 30)),
  ika_amount      NUMERIC(20, 9) NOT NULL DEFAULT 0,
  locked_at       TIMESTAMPTZ NOT NULL,
  unlocked_at     TIMESTAMPTZ,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  drizzlets_earned NUMERIC(20, 4) NOT NULL DEFAULT 0,
  nft_id          TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS locks_wallet_idx    ON locks (wallet_address);
CREATE INDEX IF NOT EXISTS locks_is_active_idx ON locks (is_active);
CREATE INDEX IF NOT EXISTS locks_duration_idx  ON locks (lock_duration);

-- ─── isui_locks ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS isui_locks (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  wallet_address  TEXT NOT NULL REFERENCES wallets(address) ON DELETE CASCADE,
  tx_digest       TEXT UNIQUE NOT NULL,
  isui_amount     NUMERIC(20, 9) NOT NULL DEFAULT 0,
  locked_at       TIMESTAMPTZ NOT NULL,
  unlocked_at     TIMESTAMPTZ,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  drizzlets_earned NUMERIC(20, 4) NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS isui_locks_wallet_idx ON isui_locks (wallet_address);

-- ─── drizzlets ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS drizzlets (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  wallet_address TEXT NOT NULL,
  source         TEXT NOT NULL CHECK (source IN ('ika_lock', 'isui_lock', 'riddle', 'unlock')),
  amount         NUMERIC(20, 4) NOT NULL DEFAULT 0,
  reference_id   TEXT,
  earned_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS drizzlets_wallet_idx ON drizzlets (wallet_address);
CREATE INDEX IF NOT EXISTS drizzlets_source_idx ON drizzlets (source);

-- ─── riddle_pools ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS riddle_pools (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pool_index  INTEGER NOT NULL CHECK (pool_index IN (1, 2, 3)),
  amount      NUMERIC(20, 9) NOT NULL DEFAULT 0,
  raw_amount  TEXT NOT NULL DEFAULT '0',
  fetched_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS riddle_pools_index_idx ON riddle_pools (pool_index);

-- ─── dashboard_cache ──────────────────────────────────────────────────────────
-- Stores aggregated metrics so the frontend never hits chain directly
CREATE TABLE IF NOT EXISTS dashboard_cache (
  id                        TEXT PRIMARY KEY DEFAULT 'main',
  total_ika_staked          NUMERIC(20, 9) NOT NULL DEFAULT 0,
  total_isui_staked         NUMERIC(20, 9) NOT NULL DEFAULT 0,
  total_locked_nfts         INTEGER NOT NULL DEFAULT 0,
  total_unlocked_nfts       INTEGER NOT NULL DEFAULT 0,
  total_staking_nfts        INTEGER NOT NULL DEFAULT 0,
  unique_staking_wallets    INTEGER NOT NULL DEFAULT 0,
  total_drizzlets_earned    NUMERIC(20, 4) NOT NULL DEFAULT 0,
  forecast_drizzlets_30d    NUMERIC(20, 4) NOT NULL DEFAULT 0,
  forecast_drizzlets_60d    NUMERIC(20, 4) NOT NULL DEFAULT 0,
  forecast_drizzlets_season NUMERIC(20, 4) NOT NULL DEFAULT 0,
  last_indexed_at           TIMESTAMPTZ,
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Insert default row
INSERT INTO dashboard_cache (id) VALUES ('main') ON CONFLICT (id) DO NOTHING;

-- ─── lock_distribution_cache ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lock_distribution_cache (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  duration    INTEGER NOT NULL CHECK (duration IN (0, 1, 7, 30)),
  label       TEXT NOT NULL,
  percentage  NUMERIC(5, 2) NOT NULL DEFAULT 0,
  total_nfts  INTEGER NOT NULL DEFAULT 0,
  total_ika   NUMERIC(20, 9) NOT NULL DEFAULT 0,
  rate        INTEGER NOT NULL DEFAULT 1,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS lock_dist_duration_idx ON lock_distribution_cache (duration);

-- Insert defaults
INSERT INTO lock_distribution_cache (duration, label, rate) VALUES
  (0,  'Season Lock', 5),
  (1,  '1 Day Lock',  1),
  (7,  '7 Day Lock',  2),
  (30, '30 Day Lock', 3)
ON CONFLICT (duration) DO NOTHING;

-- ─── drizzlet_distribution_cache ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS drizzlet_distribution_cache (
  id                  TEXT PRIMARY KEY DEFAULT 'main',
  locked_ika_rewards  NUMERIC(20, 4) NOT NULL DEFAULT 0,
  isui_rewards        NUMERIC(20, 4) NOT NULL DEFAULT 0,
  unlocked_drizzlets  NUMERIC(20, 4) NOT NULL DEFAULT 0,
  riddle_rewards      NUMERIC(20, 4) NOT NULL DEFAULT 0,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO drizzlet_distribution_cache (id) VALUES ('main') ON CONFLICT (id) DO NOTHING;

-- ─── indexer_state ────────────────────────────────────────────────────────────
-- Tracks the last event cursor for incremental indexing
CREATE TABLE IF NOT EXISTS indexer_state (
  id              TEXT PRIMARY KEY,
  last_tx_digest  TEXT,
  last_event_seq  TEXT,
  last_run_at     TIMESTAMPTZ,
  is_running      BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO indexer_state (id) VALUES ('lock_events')   ON CONFLICT (id) DO NOTHING;
INSERT INTO indexer_state (id) VALUES ('unlock_events') ON CONFLICT (id) DO NOTHING;

-- ─── Row Level Security ───────────────────────────────────────────────────────
-- Allow public reads; writes only via service role key

ALTER TABLE wallets                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE locks                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE isui_locks                ENABLE ROW LEVEL SECURITY;
ALTER TABLE drizzlets                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE riddle_pools              ENABLE ROW LEVEL SECURITY;
ALTER TABLE dashboard_cache           ENABLE ROW LEVEL SECURITY;
ALTER TABLE lock_distribution_cache   ENABLE ROW LEVEL SECURITY;
ALTER TABLE drizzlet_distribution_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE indexer_state             ENABLE ROW LEVEL SECURITY;

-- Public SELECT policies
CREATE POLICY "Public read wallets"      ON wallets                    FOR SELECT USING (true);
CREATE POLICY "Public read locks"        ON locks                      FOR SELECT USING (true);
CREATE POLICY "Public read isui_locks"   ON isui_locks                 FOR SELECT USING (true);
CREATE POLICY "Public read drizzlets"    ON drizzlets                  FOR SELECT USING (true);
CREATE POLICY "Public read riddles"      ON riddle_pools               FOR SELECT USING (true);
CREATE POLICY "Public read dashboard"    ON dashboard_cache            FOR SELECT USING (true);
CREATE POLICY "Public read lock_dist"    ON lock_distribution_cache    FOR SELECT USING (true);
CREATE POLICY "Public read drizzlet_dist" ON drizzlet_distribution_cache FOR SELECT USING (true);

-- Service role full access (indexer)
CREATE POLICY "Service full wallets"    ON wallets                    FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service full locks"      ON locks                      FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service full isui"       ON isui_locks                 FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service full drizzlets"  ON drizzlets                  FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service full riddles"    ON riddle_pools               FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service full dashboard"  ON dashboard_cache            FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service full lock_dist"  ON lock_distribution_cache    FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service full drizzlet_d" ON drizzlet_distribution_cache FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service full indexer"    ON indexer_state              FOR ALL USING (auth.role() = 'service_role');
