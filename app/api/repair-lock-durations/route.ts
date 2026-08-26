/**
 * app/api/repair-lock-durations/route.ts
 *
 * ONE-OFF repair pass. Fixes lock_duration for IKA locks that were written
 * with the wrong fallback value (0) because fetchDurationsForBatchGraphQL
 * was hitting the "over 300 nodes" cost ceiling before it got chunked.
 *
 * Only touches locks where created_at is today (2026-08-26 onward) —
 * confirmed via the date-gap check that nothing older is in scope, since
 * lock_events itself returned zero rows during the entire prior outage.
 *
 * Only UPDATEs lock_duration. Nothing is deleted, nothing else changes.
 * Safe to call more than once — re-verifying an already-correct row is a no-op.
 *
 * Call with: GET /api/repair-lock-durations?secret=YOUR_CRON_SECRET
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { fetchDurationsForBatchGraphQL } from '@/lib/sui-graphql';

function getDB() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const auth = req.headers.get('authorization') || '';
  const qs   = req.nextUrl.searchParams.get('secret') || '';
  return auth === `Bearer ${secret}` || qs === secret;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = getDB();

  const { data: suspects, error } = await db
    .from('locks')
    .select('tx_digest')
    .eq('asset_type', 'ika')
    .eq('lock_duration', 0)
    .gte('created_at', '2026-08-26T00:00:00Z');

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!suspects || suspects.length === 0) {
    return NextResponse.json({ done: true, checked: 0, corrected: 0, message: 'No suspect rows found.' });
  }

  const digests = suspects.map(r => r.tx_digest);
  const realDurations = await fetchDurationsForBatchGraphQL(digests);

  let corrected = 0;
  const log: Array<{ tx_digest: string; new_duration: number }> = [];

  for (const digest of digests) {
    const realDuration = realDurations[digest];
    // Only write back if chain genuinely reports a non-zero duration —
    // if it comes back 0 too, the original 0 was already correct (a real season lock).
        if (realDuration) {
      const { error: updErr } = await db
        .from('locks')
        .update({ lock_duration: realDuration, updated_at: new Date().toISOString() })
        .eq('tx_digest', digest);

      if (!updErr) {
        corrected++;
        log.push({ tx_digest: digest, new_duration: realDuration });
      }
    }
  }

  return NextResponse.json({
    done:      true,
    checked:   digests.length,
    corrected,
    log,
  });
}
