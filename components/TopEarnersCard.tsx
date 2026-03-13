'use client';
import Link from 'next/link';
import { ArrowRight, ExternalLink } from 'lucide-react';
import { formatNumber, shortenAddress } from '@/lib/calculations';
import type { TopEarner } from '@/lib/serverSupabase';

interface Props {
  data:     TopEarner[];
  loading?: boolean;
}

const MEDALS = ['🥇', '🥈', '🥉'];

export default function TopEarnersCard({ data, loading }: Props) {
  if (loading) {
    return (
      <div className="card p-5">
        <div className="shimmer h-5 w-40 rounded mb-4" />
        <div className="space-y-3">
          {[0, 1, 2].map(i => <div key={i} className="shimmer h-16 rounded-xl" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="card p-5 animate-slide-up" style={{ animationDelay: '300ms' }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-display font-semibold text-sm text-white">Top Earners</h3>
        <Link
          href="/leaderboard"
          className="flex items-center gap-1 text-xs text-ika-pink hover:text-ika-pink/80 transition-colors font-medium"
        >
          View full leaderboard
          <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </div>

      {data.length === 0 ? (
        <p className="text-sm text-ika-muted text-center py-6">No data yet</p>
      ) : (
        <div className="space-y-2.5">
          {data.map((earner, i) => (
            <div
              key={earner.address}
              className="flex items-center gap-3 bg-white/[0.03] border border-white/5 rounded-xl px-4 py-3 hover:border-white/10 transition-colors group"
            >
              {/* Medal */}
              <span className="text-xl leading-none flex-shrink-0">{MEDALS[i]}</span>

              {/* Wallet */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="font-mono text-[12px] text-ika-text">
                    {shortenAddress(earner.address)}
                  </span>
                  <a
                    href={`https://suiexplorer.com/address/${earner.address}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity"
                    aria-label="View on explorer"
                  >
                    <ExternalLink className="w-3 h-3 text-ika-dim" />
                  </a>
                </div>
                <p className="text-[10px] text-ika-muted mt-0.5">
                  {formatNumber(earner.ika_locked, 2)} IKA staked
                </p>
              </div>

              {/* Total drizzlets */}
              <div className="text-right flex-shrink-0">
                <p className="font-mono font-bold text-sm text-ika-pink leading-none">
                  {formatNumber(earner.total_drizzlets, 0)}
                </p>
                <p className="text-[10px] text-ika-muted mt-0.5">drizzlets</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
