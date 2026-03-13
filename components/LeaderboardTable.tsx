'use client';
import { Crown, Wallet, Copy, CheckCheck, ExternalLink } from 'lucide-react';
import { useState, useCallback } from 'react';
import { formatNumber, shortenAddress } from '@/lib/calculations';
import clsx from 'clsx';
import type { LeaderboardEntry } from '@/app/api/leaderboard/route';

interface Props {
  data:     LeaderboardEntry[];
  loading?: boolean;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) return <span className="text-lg leading-none" title="Rank 1">🥇</span>;
  if (rank === 2) return <span className="text-lg leading-none" title="Rank 2">🥈</span>;
  if (rank === 3) return <span className="text-lg leading-none" title="Rank 3">🥉</span>;
  return <span className="font-mono text-xs text-ika-dim tabular-nums">#{rank}</span>;
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
      aria-label="View wallet on Sui Explorer"
    >
      <ExternalLink className="w-3 h-3 text-ika-dim" />
    </a>
  );
}

function YesNo({ value }: { value: boolean }) {
  return (
    <span className={clsx(
      'inline-flex items-center justify-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide',
      value
        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
        : 'bg-red-500/15 text-red-400 border border-red-500/20'
    )}>
      {value ? 'Yes' : 'No'}
    </span>
  );
}

function Num({ n, decimals = 0, className }: { n: number; decimals?: number; className?: string }) {
  return (
    <span className={clsx('font-mono text-[12px] tabular-nums', className)}>
      {formatNumber(n, decimals)}
    </span>
  );
}

// Column header helper
const TH = ({ children, right, center, sub }: {
  children: React.ReactNode;
  right?:   boolean;
  center?:  boolean;
  sub?:     string;
}) => (
  <th className={clsx(
    'px-3 py-3 text-[10px] font-semibold text-ika-muted uppercase tracking-widest whitespace-nowrap select-none',
    right  && 'text-right',
    center && 'text-center',
    !right && !center && 'text-left',
  )}>
    <div>{children}</div>
    {sub && <div className="text-[9px] font-normal text-ika-muted/60 normal-case tracking-normal mt-0.5">{sub}</div>}
  </th>
);

// ── Loading skeleton ──────────────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div className="card overflow-hidden animate-fade-in">
      <div className="px-5 py-3 border-b border-ika-border">
        <div className="grid grid-cols-8 gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="shimmer h-3 rounded" />
          ))}
        </div>
      </div>
      {Array.from({ length: 10 }).map((_, i) => (
        <div key={i} className="px-5 py-3 border-b border-ika-border/40">
          <div className="grid grid-cols-8 gap-3">
            {Array.from({ length: 8 }).map((_, j) => (
              <div key={j} className="shimmer h-4 rounded" style={{ opacity: 1 - i * 0.07 }} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Main Table ────────────────────────────────────────────────────────────────

export default function LeaderboardTable({ data, loading }: Props) {
  if (loading) return <LoadingSkeleton />;

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

      {/* ── Desktop table (scrollable horizontally) ──────────────────────────── */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full min-w-[1280px]" aria-label="Leaderboard">
          <thead>
            <tr className="border-b border-ika-border bg-white/[0.02]">
              <TH>Rank</TH>
              <TH>Wallet</TH>
              <TH right>IKA Staked</TH>
              <TH right>iSUI Staked</TH>
              <TH right>Drz from IKA</TH>
              <TH right>Drz from iSUI</TH>

              {/* Riddle group */}
              <TH center sub="Solved">Riddle 1</TH>
              <TH center sub="Solved">Riddle 2</TH>
              <TH center sub="Solved">Riddle 3</TH>
              <TH right>Riddle Drizzlets</TH>

              <TH right sub="Drizzlets earned">NFTs Revealed</TH>
              <TH center>Community Code</TH>
              <TH right>Locked Drz</TH>
              <TH right>Unlocked Drz</TH>
              <TH right>Total Drizzlets</TH>
            </tr>
          </thead>
          <tbody>
            {data.map((row, i) => (
              <tr
                key={row.wallet_address}
                className={clsx(
                  'border-b border-ika-border/40 hover:bg-white/[0.025] transition-colors group',
                  i < 3 && 'bg-ika-pink/[0.02]'
                )}
              >
                {/* Rank */}
                <td className="px-3 py-3 w-12">
                  <RankBadge rank={row.rank} />
                </td>

                {/* Wallet */}
                <td className="px-3 py-3 max-w-0 min-w-[140px]">
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-[12px] text-ika-text">
                      {shortenAddress(row.wallet_address)}
                    </span>
                    <CopyAddress address={row.wallet_address} />
                    <SuiLink    address={row.wallet_address} />
                  </div>
                </td>

                {/* IKA staked */}
                <td className="px-3 py-3 text-right">
                  <Num n={row.ika_locked} decimals={2} className="text-white" />
                </td>

                {/* iSUI staked */}
                <td className="px-3 py-3 text-right">
                  <Num n={row.isui_locked} decimals={2} className="text-violet-300" />
                </td>

                {/* Drizzlets from IKA */}
                <td className="px-3 py-3 text-right">
                  <Num n={row.drz_from_ika} className="text-amber-300" />
                </td>

                {/* Drizzlets from iSUI */}
                <td className="px-3 py-3 text-right">
                  <Num n={row.drz_from_isui} className="text-violet-300" />
                </td>

                {/* Riddle 1 */}
                <td className="px-3 py-3 text-center">
                  <YesNo value={row.riddle_one_solved} />
                </td>

                {/* Riddle 2 */}
                <td className="px-3 py-3 text-center">
                  <YesNo value={row.riddle_two_solved} />
                </td>

                {/* Riddle 3 */}
                <td className="px-3 py-3 text-center">
                  <YesNo value={row.riddle_three_solved} />
                </td>

                {/* Riddle Drizzlets */}
                <td className="px-3 py-3 text-right">
                  <Num n={row.drz_riddle} className="text-ika-pink" />
                </td>

                {/* NFTs Revealed + drizzlets earned */}
                <td className="px-3 py-3 text-right">
                  <div>
                    <span className="inline-flex items-center justify-center min-w-[28px] px-2 py-0.5 rounded-lg bg-white/5 font-mono text-xs text-ika-dim">
                      {row.nfts_revealed}
                    </span>
                    <div className="font-mono text-[10px] text-amber-300/70 mt-0.5 tabular-nums">
                      {formatNumber(row.drz_nft, 0)} drz
                    </div>
                  </div>
                </td>

                {/* Community Code */}
                <td className="px-3 py-3 text-center">
                  <YesNo value={row.community_code_used} />
                </td>

                {/* Locked Drizzlets */}
                <td className="px-3 py-3 text-right">
                  <Num n={row.locked_drizzlets} className="text-cyan-300" />
                </td>

                {/* Unlocked Drizzlets */}
                <td className="px-3 py-3 text-right">
                  <Num n={row.unlocked_drizzlets} className="text-emerald-300" />
                </td>

                {/* Total Drizzlets */}
                <td className="px-3 py-3 text-right">
                  <span className="font-mono font-bold text-[13px] text-ika-pink">
                    {formatNumber(row.total_drizzlets, 0)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Mobile cards ─────────────────────────────────────────────────────── */}
      <div className="md:hidden divide-y divide-ika-border/40">
        {data.map((row, i) => (
          <div key={row.wallet_address} className={clsx('p-4 group', i < 3 && 'bg-ika-pink/[0.025]')}>

            {/* Header row */}
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

            {/* Staked amounts */}
            <div className="grid grid-cols-2 gap-2 mb-3">
              <div className="bg-white/[0.03] rounded-lg px-3 py-2">
                <p className="text-[10px] text-ika-muted uppercase tracking-wider">IKA Staked</p>
                <p className="font-mono text-xs text-white mt-0.5">{formatNumber(row.ika_locked, 2)}</p>
              </div>
              <div className="bg-white/[0.03] rounded-lg px-3 py-2">
                <p className="text-[10px] text-ika-muted uppercase tracking-wider">iSUI Staked</p>
                <p className="font-mono text-xs text-violet-300 mt-0.5">{formatNumber(row.isui_locked, 2)}</p>
              </div>
            </div>

            {/* Drizzlet sources */}
            <div className="grid grid-cols-2 gap-2 mb-3">
              <div className="bg-white/[0.03] rounded-lg px-3 py-2">
                <p className="text-[10px] text-ika-muted uppercase tracking-wider">From IKA</p>
                <p className="font-mono text-xs text-amber-300 mt-0.5">{formatNumber(row.drz_from_ika, 0)}</p>
              </div>
              <div className="bg-white/[0.03] rounded-lg px-3 py-2">
                <p className="text-[10px] text-ika-muted uppercase tracking-wider">From iSUI</p>
                <p className="font-mono text-xs text-violet-300 mt-0.5">{formatNumber(row.drz_from_isui, 0)}</p>
              </div>
              <div className="bg-white/[0.03] rounded-lg px-3 py-2">
                <p className="text-[10px] text-ika-muted uppercase tracking-wider">Locked Drz</p>
                <p className="font-mono text-xs text-cyan-300 mt-0.5">{formatNumber(row.locked_drizzlets, 0)}</p>
              </div>
              <div className="bg-white/[0.03] rounded-lg px-3 py-2">
                <p className="text-[10px] text-ika-muted uppercase tracking-wider">Unlocked Drz</p>
                <p className="font-mono text-xs text-emerald-300 mt-0.5">{formatNumber(row.unlocked_drizzlets, 0)}</p>
              </div>
            </div>

            {/* Riddles + extras */}
            <div className="flex flex-wrap gap-2 items-center pt-2 border-t border-ika-border/30">
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-ika-muted">R1</span>
                <YesNo value={row.riddle_one_solved} />
              </div>
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-ika-muted">R2</span>
                <YesNo value={row.riddle_two_solved} />
              </div>
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-ika-muted">R3</span>
                <YesNo value={row.riddle_three_solved} />
              </div>
              <div className="w-px h-3 bg-ika-border/50" />
              <span className="text-[10px] text-ika-muted">
                Riddle: <span className="text-ika-pink font-mono">{formatNumber(row.drz_riddle, 0)}</span>
              </span>
              <div className="w-px h-3 bg-ika-border/50" />
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-ika-muted">Code</span>
                <YesNo value={row.community_code_used} />
              </div>
              <div className="w-px h-3 bg-ika-border/50" />
              <span className="text-[10px] text-ika-muted">
                NFTs: <span className="text-ika-text font-mono">{row.nfts_revealed}</span>
                <span className="text-amber-300/70 font-mono ml-1">({formatNumber(row.drz_nft, 0)} drz)</span>
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
