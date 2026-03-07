import { Clock, AlertCircle, Droplets } from 'lucide-react';
import MetricCard from '@/components/MetricCard';
import DrizzletPieChart from '@/components/DrizzletPieChart';
import LockDistributionChart from '@/components/LockDistributionChart';
import ForecastCard from '@/components/ForecastCard';
import RiddlePoolCard from '@/components/RiddlePoolCard';
import RefreshButton from '@/components/RefreshButton';
import {
  serverGetDashboard,
  serverGetRiddlePools,
  serverGetLockDist,
  serverGetDrizzletDist,
} from '@/lib/serverSupabase';

export const revalidate = 300;

export default async function DashboardPage() {
  const [m, riddle, lockDist, drizzDist] = await Promise.all([
    serverGetDashboard(),
    serverGetRiddlePools(),
    serverGetLockDist(),
    serverGetDrizzletDist(),
  ]);

  const hasIndexed = !!m?.last_indexed_at;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
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

      {!hasIndexed && (
        <div className="flex items-center gap-3 p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-sm">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <span>No data indexed yet. Click <strong>Refresh</strong> above or run the indexer URL.</span>
        </div>
      )}

      <div className="grid-dashboard">
        <MetricCard title="Total IKA Staked"   value={m?.total_ika_staked ?? 0}          iconName="Coins"      iconColor="text-ika-pink"    accent  suffix=" IKA"  animationDelay={0}   />
        <MetricCard title="Total iSUI Staked"  value={m?.total_isui_staked ?? 0}         iconName="Droplets"   iconColor="text-violet-400"          suffix=" iSUI" animationDelay={50}  />
        <MetricCard title="Locked NFTs"        value={m?.total_locked_nfts ?? 0}         iconName="Lock"       iconColor="text-amber-400"           decimals={0}   animationDelay={100} />
        <MetricCard title="Unlocked NFTs"      value={m?.total_unlocked_nfts ?? 0}       iconName="Unlock"     iconColor="text-emerald-400"         decimals={0}   animationDelay={150} />
        <MetricCard title="Total Staking NFTs" value={m?.total_staking_nfts ?? 0}        iconName="LayoutGrid" iconColor="text-cyan-400"            decimals={0}   animationDelay={200} />
        <MetricCard title="Unique Wallets"     value={m?.unique_staking_wallets ?? 0}    iconName="Users"      iconColor="text-blue-400"            decimals={0}   animationDelay={250} />
        <MetricCard title="Total Drizzlets"    value={m?.total_drizzlets_earned ?? 0}    iconName="Sparkles"   iconColor="text-ika-pink"    accent                 animationDelay={300} />
        <MetricCard title="Season Forecast"    value={m?.forecast_drizzlets_season ?? 0} iconName="TrendingUp" iconColor="text-emerald-400"         subtitle="Projected total" animationDelay={350} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-5">
        <DrizzletPieChart data={drizzDist} />
        <LockDistributionChart data={lockDist} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-5">
        <RiddlePoolCard data={riddle} />
        <ForecastCard
          current={m?.total_drizzlets_earned ?? 0}
          day30={m?.forecast_drizzlets_30d ?? 0}
          day60={m?.forecast_drizzlets_60d ?? 0}
          seasonEnd={m?.forecast_drizzlets_season ?? 0}
        />
      </div>

      <div className="card p-5 animate-slide-up" style={{ animationDelay: '400ms' }}>
        <h3 className="font-display font-semibold text-sm text-white mb-4">Reward Rate Reference</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <div>
            <p className="text-xs text-ika-dim uppercase tracking-widest mb-3">IKA Lock Rates</p>
            <div className="space-y-2">
              {[
                { label: '1 Day Lock',  rate: '1 drizzlet / 10 IKA / day',  color: 'text-cyan-400',    bg: 'bg-cyan-400/10'    },
                { label: '7 Day Lock',  rate: '2 drizzlets / 10 IKA / day', color: 'text-violet-400',  bg: 'bg-violet-400/10'  },
                { label: '30 Day Lock', rate: '3 drizzlets / 10 IKA / day', color: 'text-emerald-400', bg: 'bg-emerald-400/10' },
                { label: 'Season Lock', rate: '5 drizzlets / 10 IKA / day', color: 'text-ika-pink',    bg: 'bg-ika-pink/10'    },
              ].map((r) => (
                <div key={r.label} className={`flex items-center justify-between p-2.5 rounded-lg ${r.bg} border border-white/5`}>
                  <span className={`text-xs font-semibold ${r.color}`}>{r.label}</span>
                  <span className="font-mono text-xs text-ika-dim">{r.rate}</span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs text-ika-dim uppercase tracking-widest mb-3">iSUI Rate</p>
            <div className="border border-violet-500/20 rounded-xl p-4 flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <Droplets className="w-4 h-4 text-violet-400 flex-shrink-0" />
                <span className="font-mono text-sm text-violet-300">1 drizzlet per iSUI per day</span>
              </div>
              <p className="text-xs text-ika-muted">Only full 24-hour periods count.</p>
              <div className="bg-black/20 rounded-lg px-3 py-2 font-mono text-xs text-ika-dim">
                1,000 iSUI × 4 days = <span className="text-white font-bold">4,000 drizzlets</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
                }
