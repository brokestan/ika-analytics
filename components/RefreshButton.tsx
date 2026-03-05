'use client';
import { RefreshCw, Check, AlertCircle } from 'lucide-react';
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
      const res  = await fetch('/api/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json() as { success?: boolean; error?: string };
      if (res.status === 401)     { setStatus('error');   setMsg('Admin only');    }
      else if (res.status === 409){ setStatus('idle');    setMsg('Already running…'); }
      else if (data.success)      { setStatus('success'); setMsg('Refreshed!'); setTimeout(() => window.location.reload(), 1200); }
      else                        { setStatus('error');   setMsg(data.error || 'Failed'); }
    } catch {
      setStatus('error');
      setMsg('Network error');
    }
    setTimeout(() => { setStatus('idle'); setMsg(''); }, 4000);
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={handleRefresh}
        disabled={status === 'loading'}
        className={clsx(
          'flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium border transition-all disabled:opacity-50 disabled:cursor-not-allowed',
          status === 'success' ? 'border-emerald-500/40 text-emerald-400 bg-emerald-500/10' :
          status === 'error'   ? 'border-red-500/40 text-red-400 bg-red-500/10' :
          'border-ika-border text-ika-dim hover:border-ika-pink/40 hover:text-ika-text bg-transparent'
        )}
      >
        {status === 'loading' && <RefreshCw className="w-4 h-4 animate-spin" />}
        {status === 'success' && <Check className="w-4 h-4 text-emerald-400" />}
        {status === 'error'   && <AlertCircle className="w-4 h-4 text-red-400" />}
        {status === 'idle'    && <RefreshCw className="w-4 h-4" />}
        <span className="hidden sm:inline">
          {status === 'loading' ? 'Indexing…' : status === 'success' ? 'Done!' : status === 'error' ? 'Error' : 'Refresh Data'}
        </span>
      </button>
      {msg && <p className="text-xs text-ika-muted">{msg}</p>}
    </div>
  );
}
