'use client';
import { RefreshCw, Check, AlertCircle, Info } from 'lucide-react';
import { useState } from 'react';
import clsx from 'clsx';

type Status = 'idle' | 'loading' | 'success' | 'error';

export default function RefreshButton() {
  const [status, setStatus] = useState<Status>('idle');
  const [msg,    setMsg]    = useState('');

  const handleRefresh = async () => {
    if (status === 'loading') return;
    setStatus('loading');
    setMsg('');

    try {
      // NOTE: In a real deployment the CRON_SECRET should NOT be in the browser.
      // The refresh button only works if CRON_SECRET is empty OR you pass it via
      // a protected admin panel. For public use, we omit the secret and rely on
      // the middleware rate limit to prevent abuse.
      const res  = await fetch('/api/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({}),
      });
      const data = await res.json() as { success?: boolean; error?: string; message?: string };

      if (res.status === 401) {
        setStatus('error');
        setMsg('Admin only — set CRON_SECRET in env');
      } else if (res.status === 409) {
        setStatus('idle');
        setMsg('Already running…');
      } else if (data.success) {
        setStatus('success');
        setMsg('Data refreshed!');
        setTimeout(() => window.location.reload(), 1200);
      } else {
        setStatus('error');
        setMsg(data.error || 'Failed');
      }
    } catch {
      setStatus('error');
      setMsg('Network error');
    }

    setTimeout(() => { setStatus('idle'); setMsg(''); }, 4000);
  };

  const icons: Record<Status, React.ReactNode> = {
    idle:    <RefreshCw className="w-4 h-4" />,
    loading: <RefreshCw className="w-4 h-4 animate-spin" />,
    success: <Check     className="w-4 h-4 text-emerald-400" />,
    error:   <AlertCircle className="w-4 h-4 text-red-400" />,
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={handleRefresh}
        disabled={status === 'loading'}
        title="Trigger manual data re-index"
        className={clsx(
          'flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium border transition-all',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          status === 'success'
            ? 'border-emerald-500/40 text-emerald-400 bg-emerald-500/10'
            : status === 'error'
            ? 'border-red-500/40 text-red-400 bg-red-500/10'
            : 'border-ika-border text-ika-dim hover:border-ika-pink/40 hover:text-ika-text bg-transparent'
        )}
      >
        {icons[status]}
        <span className="hidden sm:inline">
          {status === 'loading' ? 'Indexing…'
           : status === 'success' ? 'Done!'
           : status === 'error'   ? 'Error'
           : 'Refresh Data'}
        </span>
      </button>
      {msg && (
        <p className="text-xs text-ika-muted flex items-center gap-1">
          <Info className="w-3 h-3" />
          {msg}
        </p>
      )}
    </div>
  );
}
