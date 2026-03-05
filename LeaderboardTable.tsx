'use client';
import { Crown, Wallet, Copy, CheckCheck, ExternalLink } from 'lucide-react';
import { useState, useCallback } from 'react';
import { formatNumber, shortenAddress } from '@/lib/calculations';
import clsx from 'clsx';

interface LeaderboardEntry {
  rank:            number;
  wallet_address:  string;
  ika_locked:      number;
  isui_locked:     number;
  active_locks:    number;
  total_drizzlets: number;
}

interface Props {
  data:     LeaderboardEntry[];
  loading?: boolean;
}

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) return <span className="text-lg leading-none" title="Rank 1">🥇</span>;
  if (rank === 2) return <span className="text-lg leading-none" title="Rank 2">🥈</span>;
  if (rank === 3) return <span className="text-lg leading-none" title="Rank 3">🥉</span>;
  return (
    <span className="font-mono text-xs text-ika-dim tabular-nums">
      #{rank}
    </span>
  );
}

function CopyAddress({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(address).catch(() => null);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }, [address]);

  return (
    <button
      onClick={handleCopy}
      title={copied ? 'Copied!' : 'Copy full address'}
      className="opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity p-0.5 rounded"
      aria-label={copied ? 'Address copied' : 'Copy wallet address'}
    >
      {copied
        ? <CheckCheck className="w-3.5 h-3.5 text-emerald-400" />
        : <Copy       className="w-3.5 h-3.5 text-ika-dim" />
      }
    </button>
  );
}

function SuiLink({ address }: { address: string }) {
  return (
    <a
      href={`https://suiexplorer.com/address/${address}`}
      target="_blank"
      rel="noopener noreferrer"
      title="View on Sui Explorer"
      className="opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity p-0.5 rounded"
      aria-label="View wallet on Sui Explorer (opens in new tab)"
    >
      <ExternalLink className="w-3 h-3 text-ika-dim" />
    </a>
  );
}

export default function LeaderboardTable({ data, loading }: Props) {
  if (loading) {
    return (
      <div className="card overflow-hidden animate-fade-in">
        <div className="px-5 py-3 border-b border-ika-border">
          <div className="grid grid-cols-6 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="shimmer h-3 rounded" />
            ))}
          </div>
        </div>
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="px-5 py-3.5 border-b border-ika-border/40">
            <div className="grid grid-cols-6 gap-4">
              {Array.from({ length: 6 }).map((_, j) => (
                <div key={j} className="shimmer h-4 rounded" style={{ opacity: 1 - i * 0.07 }} />
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (!data.length) {
    return (
      <div className="card p-12 text-center animate-fade-in">
        <Wallet className="w-10 h-10 mx-auto text-ika-muted/30 mb-3" aria-hidden="true" />
        <p className="text-ika-dim font-medium">No wallets found</p>
        <p className="text-xs text-ika-muted mt-1">Try a different address, or run the indexer first</p>
      </div>
    );
  }

  return (
    <div className="card overflow-hidden animate-fade-in">
      {/* ── Desktop Table ──────────────────────────────────────────────────── */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full" aria-label="Leaderboard">
          <thead>
            <tr className="border-b border-ika-border">
              {[
                { label: 'Rank',            align: 'left'  },
                { label: 'Wallet Address',  align: 'left'  },
                { label: 'IKA Locked',      align: 'right' },
                { label: 'iSUI Locked',     align: 'right' },
                { label: 'Active Locks',    align: 'center'},
                { label: 'Total Drizzlets', align: 'right' },
              ].map(h => (
                <th
                  key={h.label}
                  scope="col"
                  className={clsx(
                    'px-5 py-3 text-[11px] font-semibold text-ika-muted uppercase tracking-widest',
                    h.align === 'right'  && 'text-right',
                    h.align === 'center' && 'text-center',
                    h.align === 'left'   && 'text-left',
                  )}
                >
                  {h.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((row, i) => (
              <tr
                key={row.wallet_address}
                className={clsx(
                  'border-b border-ika-border/40 hover:bg-white/[0.025] transition-colors group',
                  i < 3 && 'bg-ika-pink/[0.025]'
                )}
              >
                <td className="px-5 py-3.5 w-14">
                  <RankBadge rank={row.rank} />
                </td>
                <td className="px-5 py-3.5 max-w-0">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="font-mono text-[13px] text-ika-text truncate">
                      {shortenAddress(row.wallet_address)}
                    </span>
                    <CopyAddress address={row.wallet_address} />
                    <SuiLink    address={row.wallet_address} />
                  </div>
                </td>
                <td className="px-5 py-3.5 text-right">
                  <span className="font-mono text-[13px] text-white">
                    {formatNumber(row.ika_locked, 2)}
                  </span>
                </td>
                <td className="px-5 py-3.5 text-right">
                  <span className="font-mono text-[13px] text-violet-300">
                    {formatNumber(row.isui_locked, 2)}
                  </span>
                </td>
                <td className="px-5 py-3.5 text-center">
                  <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-white/5 font-mono text-xs text-ika-dim">
                    {row.active_locks}
                  </span>
                </td>
                <td className="px-5 py-3.5 text-right">
                  <span className="font-mono font-bold text-[13px] text-ika-pink">
                    {formatNumber(row.total_drizzlets, 0)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Mobile Cards ──────────────────────────────────────────────────── */}
      <div className="md:hidden divide-y divide-ika-border/40">
        {data.map((row, i) => (
          <div
            key={row.wallet_address}
            className={clsx('p-4 group', i < 3 && 'bg-ika-pink/[0.025]')}
          >
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-2.5">
                <RankBadge rank={row.rank} />
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-[13px] text-ika-text">
                      {shortenAddress(row.wallet_address)}
                    </span>
                    <CopyAddress address={row.wallet_address} />
                    <SuiLink    address={row.wallet_address} />
                  </div>
                  <p className="text-[11px] text-ika-muted mt-0.5">
                    {row.active_locks} active {row.active_locks === 1 ? 'lock' : 'locks'}
                  </p>
                </div>
              </div>
              <div className="text-right flex-shrink-0">
                <p className="font-mono font-bold text-base text-ika-pink leading-none">
                  {formatNumber(row.total_drizzlets, 0)}
                </p>
                <p className="text-[11px] text-ika-muted mt-0.5">drizzlets</p>
              </div>
            </div>

            {/* Token stats row */}
            <div className="flex gap-3 pt-2 border-t border-ika-border/30">
              <div>
                <p className="text-[10px] text-ika-dim uppercase tracking-wider mb-0.5">IKA</p>
                <p className="font-mono text-xs text-white">{formatNumber(row.ika_locked, 2)}</p>
              </div>
              <div className="w-px bg-ika-border/50" />
              <div>
                <p className="text-[10px] text-ika-dim uppercase tracking-wider mb-0.5">iSUI</p>
                <p className="font-mono text-xs text-violet-300">{formatNumber(row.isui_locked, 2)}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
