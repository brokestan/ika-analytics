import type { ReactNode } from 'react';
import {
  Coins, Droplets, Lock, Unlock, LayoutGrid,
  Users, Sparkles, TrendingUp, Clock, AlertCircle,
} from 'lucide-react';
import MetricCard          from '@/components/MetricCard';
import DrizzletPieChart    from '@/components/DrizzletPieChart';
import LockDistributionChart from '@/components/LockDistributionChart';
import LockedUnlockedChart  from '@/components/LockedUnlockedChart';
import ForecastCard        from '@/components/ForecastCard';
import RiddlePoolCard      from '@/components/RiddlePoolCard';
import NftRevealsCard      from '@/components/NftRevealsCard';
import CommunityCodeCard   from '@/components/CommunityCodeCard';
import TopEarnersCard      from '@/components/TopEarnersCard';
import RefreshButton       from '@/components/RefreshButton';
import {
  serverGetDashboard,
  serverGetRiddlePools,
  serverGetLockDist,
  serverGetDrizzletBreakdown,
  serverGetRiddleStats,
  serverGetNftStats,
  serverGetCodeStats,
  serverGetTopEarners,
  serverGetPrices,
} from '@/lib/serverSupabase';
import { formatNumber } from '@/lib/calculations';

export const revalidate = 300;

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="text-[11px] font-semibold text-ika-muted tracking-widest uppercase mb-3 mt-2">
      {children}
    </p>
  );
}

export default async function DashboardPage() {
  const [m, riddle, lockDist, drizzBreakdown, riddleStats, nftStats, codeStats, topEarners, prices] =
    await Promise.all([
      serverGetDashboard(),
      serverGetRiddlePools(),
      serverGetLockDist(),
      serverGetDrizzletBreakdown(),
      serverGetRiddleStats(),
      serverGetNftStats(),
      serverGetCodeStats(),
      serverGetTopEarners(3),
      serverGetPrices(),
    ]);

  const loading    = false;
  const hasIndexed = !!m?.last_indexed_at;

  // Compute 45-day forecast for season forecast metric card
  const current = m?.total_drizzlets_earned  ?? 0;
  const day30   = m?.forecast_drizzlets_30d  ?? 0;
  const day60   = m?.forecast_drizzlets_60d  ?? 0;
  const dailyRate = (day30 - current) / 30;
  const day45   = Math.round(current + dailyRate * 45);

  // USD value helpers (graceful — only shown if price is available)
  const ikaUsd  = prices.ika;
  const isuiUsd = prices.sui; // iSUI ≈ SUI price
  const fmt$    = (n: number) => `$${formatNumber(n, 1)}`;

  // Pass breakdown directly to pie chart — all 6 sources already split correctly
  const enrichedDrizzDist = drizzBreakdown ?? null;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display font-bold text-2xl sm:text-3xl text-white tracking-tight">
            Analytics <span className="text-ika-gradient">Dashboard</span>
          </h1>
          <p className="text-sm text-ika-dim mt-1 flex items-center gap-2">
            IKA &amp; iSUI staking metrics · Sui ecosystem
            {m?.last_indexed_at && (
              <span className="inline-flex items-center gap-1 text-xs text-ika-muted">
                <Clock className="w-3 h-3" />
                {new Date(m.last_indexed_at).toLocaleDateString('en-US', {
                  month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                })}
              </span>
            )}
          </p>
        </div>
        <RefreshButton />
      </div>

      {/* ── Not-yet-indexed banner ─────────────────────────────────────────── */}
      {!hasIndexed && (
        <div className="flex items-center gap-3 p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-sm">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <span>
            No data indexed yet. Click <strong>Refresh</strong> above or run:{' '}
            <code className="font-mono text-xs bg-black/30 px-1.5 py-0.5 rounded">
              curl &quot;/api/index?secret=YOUR_CRON_SECRET&quot;
            </code>
          </span>
        </div>
      )}

      {/* ── Staking Overview ──────────────────────────────────────────────── */}
      <SectionLabel>Staking Overview</SectionLabel>
      <div className="grid-dashboard">
        <MetricCard
          title="Total IKA Staked"
          value={m?.total_ika_staked ?? 0}
          icon={Coins}
          iconColor="text-ika-pink"
          accent
          suffix=" IKA"
          subtitle={ikaUsd ? fmt$(( m?.total_ika_staked ?? 0) * ikaUsd) : undefined}
          loading={loading}
          animationDelay={0}
        />
        <MetricCard
          title="Total iSUI Staked"
          value={m?.total_isui_staked ?? 0}
          icon={Droplets}
          iconColor="text-violet-400"
          suffix=" iSUI"
          subtitle={isuiUsd ? fmt$((m?.total_isui_staked ?? 0) * isuiUsd) : undefined}
          loading={loading}
          animationDelay={50}
        />
        <MetricCard
          title="Locked NFTs"
          value={m?.total_locked_nfts ?? 0}
          icon={Lock}
          iconColor="text-amber-400"
          decimals={0}
          subtitle="active staking positions"
          loading={loading}
          animationDelay={100}
        />
        <MetricCard
          title="Unlocked NFTs"
          value={m?.total_unlocked_nfts ?? 0}
          icon={Unlock}
          iconColor="text-emerald-400"
          decimals={0}
          subtitle="completed positions"
          loading={loading}
          animationDelay={150}
        />
        <MetricCard
          title="Total Staking NFTs"
          value={m?.total_staking_nfts ?? 0}
          icon={LayoutGrid}
          iconColor="text-cyan-400"
          decimals={0}
          subtitle="all-time minted"
          loading={loading}
          animationDelay={200}
        />
        <MetricCard
          title="Unique Staking Wallets"
          value={m?.unique_staking_wallets ?? 0}
          icon={Users}
          iconColor="text-blue-400"
          decimals={0}
          loading={loading}
          animationDelay={250}
        />
        <MetricCard
          title="Total Drizzlets Earned"
          value={m?.total_drizzlets_earned ?? 0}
          icon={Sparkles}
          iconColor="text-ika-pink"
          accent
          loading={loading}
          animationDelay={300}
        />
        <MetricCard
          title="Season Forecast (45d)"
          value={day45}
          icon={TrendingUp}
          iconColor="text-emerald-400"
          subtitle="est. season end projection"
          loading={loading}
          animationDelay={350}
        />
      </div>

      {/* ── Charts ────────────────────────────────────────────────────────── */}
      <SectionLabel>Distribution</SectionLabel>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-5">
        <DrizzletPieChart data={enrichedDrizzDist} loading={loading} />
        <LockDistributionChart data={lockDist} loading={loading} />
      </div>
      <LockedUnlockedChart data={enrichedDrizzDist} loading={loading} />

      {/* ── Riddle + NFT + Community ───────────────────────────────────────── */}
      <SectionLabel>Riddle &amp; Community</SectionLabel>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-5">
        <RiddlePoolCard data={riddle} stats={riddleStats} loading={loading} />
        <NftRevealsCard data={nftStats} loading={loading} />
        <div className="flex flex-col gap-4">
          <CommunityCodeCard data={codeStats} loading={loading} />
        </div>
      </div>

      {/* ── Forecast + Top Earners ─────────────────────────────────────────── */}
      <SectionLabel>Forecast &amp; Leaderboard</SectionLabel>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-5">
        <ForecastCard
          current={current}
          day30={day30}
          day60={day60}
          seasonEnd={day45}
          loading={loading}
        />
        <TopEarnersCard data={topEarners} loading={loading} />
      </div>

    </div>
  );
}
