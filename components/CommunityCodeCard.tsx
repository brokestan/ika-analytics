'use client';
import { Users } from 'lucide-react';
import type { CodeStats } from '@/lib/serverSupabase';

interface Props {
  data:     CodeStats | null;
  loading?: boolean;
}

export default function CommunityCodeCard({ data, loading }: Props) {
  if (loading || !data) {
    return (
      <div className="card p-4">
        <div className="shimmer h-4 w-32 rounded mb-3" />
        <div className="shimmer h-8 w-full rounded" />
      </div>
    );
  }

  return (
    <div className="card p-4 animate-slide-up" style={{ animationDelay: '240ms' }}>
      <div className="flex items-center gap-2 mb-3">
        <div className="w-6 h-6 rounded-md bg-cyan-500/20 flex items-center justify-center">
          <Users className="w-3 h-3 text-cyan-400" />
        </div>
        <h3 className="font-display font-semibold text-xs text-white uppercase tracking-widest">
          Community Codes
        </h3>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex-1 bg-white/[0.03] border border-white/5 rounded-lg px-3 py-2.5 text-center">
          <p className="font-mono font-bold text-xl text-cyan-400 leading-none">
            {data.wallets_with_code.toLocaleString()}
          </p>
          <p className="text-[10px] text-ika-muted mt-1 uppercase tracking-wider">
            Wallets used a code
          </p>
        </div>
        <div className="flex-1 bg-white/[0.03] border border-white/5 rounded-lg px-3 py-2.5 text-center">
          <p className="font-mono font-bold text-xl text-violet-400 leading-none">
            {data.unique_codes.toLocaleString()}
          </p>
          <p className="text-[10px] text-ika-muted mt-1 uppercase tracking-wider">
            Unique codes
          </p>
        </div>
      </div>
    </div>
  );
}
