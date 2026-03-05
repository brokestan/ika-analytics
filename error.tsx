'use client';
import { useEffect } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log to console only — never expose stack to UI
    console.error('[App Error]', error.digest || 'unknown');
  }, [error]);

  return (
    <div className="min-h-[60vh] flex items-center justify-center px-4">
      <div className="card p-8 max-w-md w-full text-center space-y-4">
        <div className="w-12 h-12 rounded-xl bg-red-500/15 border border-red-500/30 flex items-center justify-center mx-auto">
          <AlertTriangle className="w-6 h-6 text-red-400" />
        </div>
        <h2 className="font-display font-bold text-lg text-white">Something went wrong</h2>
        <p className="text-sm text-ika-dim">
          The dashboard failed to load. This is usually a temporary issue.
        </p>
        {error.digest && (
          <p className="font-mono text-xs text-ika-muted bg-white/5 px-3 py-1.5 rounded-lg">
            Error ID: {error.digest}
          </p>
        )}
        <button
          onClick={reset}
          className="inline-flex items-center gap-2 btn-ika mx-auto"
        >
          <RefreshCw className="w-4 h-4" />
          Try again
        </button>
      </div>
    </div>
  );
}
