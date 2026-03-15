import { NextResponse } from 'next/server';
import {
  serverGetDrizzletBreakdown,
  serverGetNftStats,
  serverGetCodeStats,
} from '@/lib/serverSupabase';

export const revalidate = 0;

export async function GET() {
  const [drizzlet, nft, codes] = await Promise.all([
    serverGetDrizzletBreakdown(),
    serverGetNftStats(),
    serverGetCodeStats(),
  ]);
  return NextResponse.json({ drizzlet, nft, codes });
}
