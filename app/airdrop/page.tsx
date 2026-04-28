import { createClient } from '@supabase/supabase-js';
import { fetchAirdropPoolData } from '@/lib/sui-rpc';
import { formatNumber } from '@/lib/calculations';
import {
  Droplets, Users, ShieldCheck, ShieldOff,
  Clock, AlertCircle, BarChart3, Repeat2,
} from 'lucide-react';

export const revalidate = 300;

function getDB() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return createClient(url, key, { auth: { persistSession: false } });
}

interface AirdropStats {
  total_allocated:      number;
  sbt_allocated:        number;
  non_sbt_allocated:    number;
  total_unique_claimers:number;
  total_claim_rows:     number;
  sbt_unique_claimers:  number;
  sbt_total_txs:        number;
  sbt_total_ika:        number;
  std_unique_claimers:  number;
  std_total_txs:        number;
  std_total_ika:        number;
  sbt_partial_wallets:  number;
  std_partial_wallets:  number;
  underclaimed_wallets: number;
  underclaimed_ika:     number;
  never_claimed_wallets:number;
}

function StatCard({
  label, value, sub, color, bg, icon: Icon,
}: {
  label:  string;
  value:  string;
  sub?:   string;
  color:  string;
  bg:     string;
  icon:   React.ElementType;
}) {
  return (
    <div className={`card border p-4 animate-slide-up ${bg}`}>
      <div className="flex items-center gap-2 mb-2">
        <Icon className={`w-4 h-4 ${color}`} />
        <p className="text-[11px] font-semibold text-ika-muted tracking-widest uppercase">
          {label}
        </p>
      </div>
      <p className={`font-mono font-bold text-xl leading-none ${color}`}>{value}</p>
      {sub && <p className="text-[10px] text-ika-muted mt-1.5 leading-snug">{sub}</p>}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-semibold text-ika-muted tracking-widest uppercase mb-3 mt-2">
      {children}
    </p>
  );
}

function ClaimGroup({
  title, color, bg, borderColor,
  allocated, claimers, totalTxs, totalIka, partialWallets, pct,
}: {
  title:         string;
  color:         string;
  bg:            string;
  borderColor:   string;
  allocated:     number;
  claimers:      number;
  totalTxs:      number;
  totalIka:      number;
  partialWallets:number;
  pct:           number;
}) {
  const unclaimed = allocated - claimers;
  return (
    <div className={`card border ${borderColor} ${bg} p-5 space-y-4`}>
      <h3 className={`font-display font-bold text-sm ${color} uppercase tracking-wider`}>
        {title}
      </h3>

      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white/[0.04] rounded-xl px-3 py-2.5">
          <p className="text-[10px] text-ika-muted uppercase tracking-wider">Allocated</p>
          <p className={`font-mono font-bold text-base mt-0.5 ${color}`}>
            {allocated.toLocaleString()}
          </p>
          <p className="text-[10px] text-ika-muted mt-0.5">wallets eligible</p>
        </div>

        <div className="bg-white/[0.04] rounded-xl px-3 py-2.5">
          <p className="text-[10px] text-ika-muted uppercase tracking-wider">Claimed</p>
          <p className="font-mono font-bold text-base mt-0.5 text-emerald-400">
            {claimers.toLocaleString()}
          </p>
          <p className="text-[10px] text-ika-muted mt-0.5">
            {pct.toFixed(1)}% of allocated
          </p>
        </div>

        <div className="bg-white/[0.04] rounded-xl px-3 py-2.5">
          <p className="text-[10px] text-ika-muted uppercase tracking-wider">Never Claimed</p>
          <p className="font-mono font-bold text-base mt-0.5 text-red-400">
            {unclaimed.toLocaleString()}
          </p>
          <p className="text-[10px] text-ika-muted mt-0.5">wallets</p>
        </div>

        <div className="bg-white/[0.04] rounded-xl px-3 py-2.5">
          <p className="text-[10px] text-ika-muted uppercase tracking-wider">IKA Claimed</p>
          <p className={`font-mono font-bold text-base mt-0.5 ${color}`}>
            {formatNumber(totalIka, 1)}
          </p>
          <p className="text-[10px] text-ika-muted mt-0.5">IKA</p>
        </div>
      </div>

      <div className="flex items-center justify-between bg-white/[0.03] border border-white/5 rounded-lg px-3 py-2">
        <div className="flex items-center gap-2">
          <Repeat2 className="w-3.5 h-3.5 text-amber-400" />
          <span className="text-xs text-ika-dim">Partial claimers</span>
        </div>
        <span className="font-mono text-sm font-bold text-amber-400">
          {partialWallets.toLocaleString()}
        </span>
      </div>

      <div className="flex items-center justify-between bg-white/[0.03] border border-white/5 rounded-lg px-3 py-2">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-3.5 h-3.5 text-ika-muted" />
          <span className="text-xs text-ika-dim">Total claim events</span>
        </div>
        <span className="font-mono text-sm font-bold text-white">
          {totalTxs.toLocaleString()}
        </span>
      </div>

      {/* Claim progress bar */}
      <div>
        <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full bg-ika-gradient transition-all duration-700"
            style={{ width: `${Math.min(pct, 100)}%` }}
          />
        </div>
      </div>
    </div>
  );
}

export default async function AirdropPage() {
  const db = getDB();

  const [pool, statsRes] = await Promise.all([
    fetchAirdropPoolData(),
    db.rpc('get_airdrop_full_stats'),
  ]);

  const s = (
  statsRes.data && typeof statsRes.data === 'object' && !Array.isArray(statsRes.data)
    ? statsRes.data
    : Array.isArray(statsRes.data)
      ? statsRes.data[0]
      : null
) as AirdropStats | null;

  const sbtClaimPct = s
    ? (s.sbt_unique_claimers / Math.max(s.sbt_allocated, 1)) * 100
    : 0;
  const stdClaimPct = s
    ? (s.std_unique_claimers / Math.max(s.non_sbt_allocated, 1)) * 100
    : 0;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">

      {/* Header */}
      <div>
        <h1 className="font-display font-bold text-2xl sm:text-3xl text-white tracking-tight flex items-center gap-2.5">
          <span className="text-2xl">🪂</span>
          IKA <span className="text-ika-gradient">Airdrop</span>
        </h1>
        <p className="text-sm text-ika-dim mt-1">
          Pre-TGE allocation · IKADrop NFT claim analytics
        </p>
      </div>

      {/* Pool progress bar */}
      {pool && (
        <div className="card p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-display font-semibold text-sm text-white">Claim Progress</h3>
            <span className="font-mono text-sm text-ika-pink font-bold">
              {pool.pctClaimed.toFixed(2)}% claimed
            </span>
          </div>
          <div className="h-3 bg-white/5 rounded-full overflow-hidden">
            <div
              className="h-full bg-ika-gradient rounded-full transition-all duration-700"
              style={{ width: `${Math.min(pool.pctClaimed, 100)}%` }}
            />
          </div>
          <div className="flex justify-between mt-2 text-xs text-ika-muted font-mono">
            <span>{formatNumber(pool.claimed, 0)} IKA claimed</span>
            <span>{formatNumber(pool.balance, 0)} IKA remaining</span>
          </div>
        </div>
      )}

      {/* Pool Overview */}
      <SectionLabel>Pool Overview</SectionLabel>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          label="Total Pool"
          value={pool ? `${formatNumber(pool.totalPool, 0)} IKA` : '—'}
          sub="600M IKA airdrop"
          color="text-ika-pink"
          bg="bg-ika-pink/5 border-ika-pink/20"
          icon={Droplets}
        />
        <StatCard
          label="Total Claimed"
          value={pool ? `${formatNumber(pool.claimed, 0)} IKA` : '—'}
          sub={pool ? `${pool.pctClaimed.toFixed(2)}% of pool` : ''}
          color="text-emerald-400"
          bg="bg-emerald-500/5 border-emerald-500/20"
          icon={Droplets}
        />
        <StatCard
          label="Unclaimed"
          value={pool ? `${formatNumber(pool.balance, 0)} IKA` : '—'}
          sub="remaining in pool"
          color="text-amber-400"
          bg="bg-amber-500/5 border-amber-500/20"
          icon={Clock}
        />
        <StatCard
          label="Still Claimable"
          value={s ? `${formatNumber(s.underclaimed_ika, 0)} IKA` : '—'}
          sub={s ? `${s.underclaimed_wallets.toLocaleString()} partial wallets` : ''}
          color="text-cyan-400"
          bg="bg-cyan-500/5 border-cyan-500/20"
          icon={AlertCircle}
        />
      </div>

      {/* Recipient Overview */}
      <SectionLabel>Recipient Overview</SectionLabel>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          label="Total Allocated"
          value={s ? s.total_allocated.toLocaleString() : '—'}
          sub="wallets in allocation list"
          color="text-white"
          bg="bg-white/3 border-white/10"
          icon={Users}
        />
        <StatCard
          label="Total Claimers"
          value={s ? s.total_unique_claimers.toLocaleString() : '—'}
          sub={s ? `${((s.total_unique_claimers / s.total_allocated) * 100).toFixed(1)}% of eligible` : ''}
          color="text-emerald-400"
          bg="bg-emerald-500/5 border-emerald-500/20"
          icon={Users}
        />
        <StatCard
          label="Never Claimed"
          value={s ? s.never_claimed_wallets.toLocaleString() : '—'}
          sub="IKA left on table"
          color="text-red-400"
          bg="bg-red-500/5 border-red-500/20"
          icon={Users}
        />
        <StatCard
          label="Total Claim Events"
          value={s ? s.total_claim_rows.toLocaleString() : '—'}
          sub={s ? `${(s.total_claim_rows - s.total_unique_claimers).toLocaleString()} partial re-claims` : ''}
          color="text-violet-400"
          bg="bg-violet-500/5 border-violet-500/20"
          icon={BarChart3}
        />
      </div>

      {/* SBT vs Standard Breakdown */}
      <SectionLabel>Claim Type Breakdown</SectionLabel>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {s && (
          <ClaimGroup
            title="🔐 SBT / World ID Claims"
            color="text-violet-400"
            bg="bg-violet-500/[0.04]"
            borderColor="border-violet-500/20"
            allocated={s.sbt_allocated}
            claimers={s.sbt_unique_claimers}
            totalTxs={s.sbt_total_txs}
            totalIka={s.sbt_total_ika}
            partialWallets={s.sbt_partial_wallets}
            pct={sbtClaimPct}
          />
        )}
        {s && (
          <ClaimGroup
            title="✅ Standard Claims"
            color="text-emerald-400"
            bg="bg-emerald-500/[0.04]"
            borderColor="border-emerald-500/20"
            allocated={s.non_sbt_allocated}
            claimers={s.std_unique_claimers}
            totalTxs={s.std_total_txs}
            totalIka={s.std_total_ika}
            partialWallets={s.std_partial_wallets}
            pct={stdClaimPct}
          />
        )}
      </div>

      {/* Claim window info */}
      <div className="card p-4 border border-amber-500/20 bg-amber-500/5">
        <div className="flex items-start gap-3">
          <Clock className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
          <div className="text-xs text-ika-dim space-y-1">
            <p className="text-amber-300 font-medium">Claim Window</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-1 mt-1">
              <span>Opens: <span className="text-white font-mono">Jul 29, 2025</span></span>
              <span>Penalty ends: <span className="text-white font-mono">Oct 28, 2025</span></span>
              <span>Closes: <span className="text-white font-mono">Jul 29, 2026</span></span>
            </div>
          </div>
        </div>
      </div>

    </div>
  );
                  }
