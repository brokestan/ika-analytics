'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BarChart3, Trophy, Zap, ExternalLink } from 'lucide-react';
import clsx from 'clsx';

const navLinks = [
  { href: '/',            label: 'Dashboard',   icon: BarChart3 },
  { href: '/leaderboard', label: 'Leaderboard', icon: Trophy    },
];

export default function Navbar() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-50 border-b border-ika-border/70 bg-ika-dark/85 backdrop-blur-xl">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4">

        {/* ── Logo ──────────────────────────────────────────────────────── */}
        <Link href="/" className="flex items-center gap-2.5 group flex-shrink-0" aria-label="IKA Analytics Home">
          <div className="relative">
            <div className="w-8 h-8 rounded-xl bg-ika-gradient flex items-center justify-center shadow-ika-sm group-hover:shadow-ika transition-shadow">
              <Zap className="w-4 h-4 text-white" />
            </div>
            <span
              aria-hidden="true"
              className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-emerald-400 rounded-full border-2 border-ika-dark animate-pulse"
            />
          </div>
          <div className="leading-none">
            <span className="font-display font-extrabold text-[15px] tracking-tight text-white">IKA</span>
            <span className="font-display font-light   text-[15px] tracking-tight text-ika-dim  ml-1">Analytics</span>
          </div>
        </Link>

        {/* ── Nav links ─────────────────────────────────────────────────── */}
        <nav className="flex items-center gap-1" aria-label="Main navigation">
          {navLinks.map(({ href, label, icon: Icon }) => {
            const active = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? 'page' : undefined}
                className={clsx(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-150',
                  active
                    ? 'bg-ika-pink/15 text-ika-pink border border-ika-pink/30'
                    : 'text-ika-dim hover:text-ika-text hover:bg-white/[0.06]'
                )}
              >
                <Icon className="w-4 h-4 flex-shrink-0" />
                <span className="hidden xs:inline sm:inline">{label}</span>
              </Link>
            );
          })}
        </nav>

        {/* ── Right side: Sui explorer link ─────────────────────────────── */}
        <a
          href="https://suiexplorer.com"
          target="_blank"
          rel="noopener noreferrer"
          className="hidden sm:flex items-center gap-1.5 text-xs text-ika-muted hover:text-ika-dim transition-colors"
          aria-label="Open Sui Explorer (new tab)"
        >
          <ExternalLink className="w-3.5 h-3.5" />
          <span>Sui Explorer</span>
        </a>
      </div>
    </header>
  );
}
