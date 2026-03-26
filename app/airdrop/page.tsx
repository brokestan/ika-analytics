import { createClient } from '@supabase/supabase-js';
import { fetchAirdropPoolData } from '@/lib/sui-rpc';
import { formatNumber } from '@/lib/calculations';
import { Droplets, Users, ShieldCheck, ShieldOff, Clock } from 'lucide-react';

export const revalidate = 300;

function getDB() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return createClient(url, key, { auth: { persistSession: false } });
}

export default async function AirdropPage() {
  const db = getDB();

  const [pool, claimStats, allocStats] = await Promise.all([
    fetchAirdropPoolData(),
    db.rpc('get_airdrop_claim_stats'),
    db.from('airdrop_allocations')
      .select('wallet_address', { count: 'exact', head: true }),
  ]);

  const stats = claimStats.data as {
    total_claims:     number;
    total_claimed_ika: number;
    sbt_claims:       number;
    non_sbt_claims:   number;
  } | null;

  const totalAllocations = allocStats.count ?? 0;

  const statCards = [
    {
      label:  'Total Pool',
      value:  pool ? formatNumber(pool.totalPool, 0) + ' IKA' : '—',
      sub:    '600M IKA total airdrop',
      color:  'text-ika-pink',
      bg:     'bg-ika-pink/5 border-ika-pink/20',
      icon:   Droplets,
    },
    {
      label:  'Total Claimed',
      value:  pool ? formatNumber(pool.claimed, 0) + ' IKA' : '—',
      sub:    pool ? pool.pctClaimed.toFixed(1) + '% of pool claimed' : '',
      color:  'text-emerald-400',
      bg:     'bg-emerald-500/5 border-emerald-500/20',
      icon:   Droplets,
    },
    {
      label:  'Unclaimed',
      value:  pool ? formatNumber(pool.balance, 0) + ' IKA' : '—',
      sub:    'remaining in pool',
      color:  'text-amber-400',
      bg:     'bg-amber-500/5 border-amber-500/20',
      icon:   Clock,
    },
    {
      label:  'Total Recipients',
      value:  totalAllocations.toLocaleString(),
      sub:    'wallets in allocation list',
      color:  'text-cyan-400',
      bg:     'bg-cyan-500/5 border-cyan-500/20',
      icon:   Users,
    },
    {
      label:  'Total Claimers',
      value:  stats ? (stats.total_claims).toLocaleString() : '—',
      sub:    'unique wallets claimed',
      color:  'text-violet-400',
      bg:     'bg-violet-500/5 border-violet-500/20',
      icon:   Users,
    },
    {
      label:  'SBT Claims',
      value:  stats ? stats.sbt_claims.toLocaleString() : '—',
      sub:    'required World ID / SBT',
      color:  'text-violet-400',
      bg:     'bg-violet-500/5 border-violet-500/20',
      icon:   ShieldCheck,
    },
    {
      label:  'Standard Claims',
      value:  stats ? stats.non_sbt_claims.toLocaleString() : '—',
      sub:    'no SBT required',
      color:  'text-blue-400',
      bg:     'bg-blue-500/5 border-blue-500/20',
      icon:   ShieldOff,
    },
    {
      label:  'Unclaimed NFTs',
      value:  stats && totalAllocations
        ? (totalAllocations - stats.total_claims).toLocaleString()
        : '—',
      sub:    'allocations not yet claimed',
      color:  'text-ika-dim',
      bg:     'bg-white/3 border-white/10',
      icon:   Clock,
    },
  ];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">

      {/* Header */}
      <div>
        <h1 className="font-display font-bold text-2xl sm:text-3xl text-white tracking-tight flex items-center gap-2.5">
          <span className="text-2xl">🪂</span>
          IKA <span className="text-ika-gradient">Airdrop</span>
        </h1>
        <p className="text-sm text-ika-dim mt-1">
          Pre-TGE allocation stats · IKADrop NFT claim data
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

      {/* Stat cards grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
        {statCards.map((s) => (
          <div key={s.label} className={`card border p-4 ${s.bg} animate-slide-up`}>
            <div className="flex items-center gap-2 mb-2">
              <s.icon className={`w-4 h-4 ${s.color}`} />
              <p className="text-[11px] font-semibold text-ika-muted tracking-widest uppercase">
                {s.label}
              </p>
            </div>
            <p className={`font-mono font-bold text-xl leading-none ${s.color}`}>
              {s.value}
            </p>
            {s.sub && (
              <p className="text-[10px] text-ika-muted mt-1.5">{s.sub}</p>
            )}
          </div>
        ))}
      </div>

      {/* Claim window info */}
      <div className="card p-4 border border-amber-500/20 bg-amber-500/5">
        <div className="flex items-start gap-3">
          <Clock className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
          <div className="text-xs text-ika-dim space-y-1">
            <p className="text-amber-300 font-medium">Claim Window</p>
            <p>Claims open: <span className="text-white font-mono">Jul 29, 2025</span></p>
            <p>Claims close: <span className="text-white font-mono">Apr 28, 2026</span></p>
            <p>Penalty period ends: <span className="text-white font-mono">Oct 28, 2025</span></p>
          </div>
        </div>
      </div>

    </div>
  );
}
