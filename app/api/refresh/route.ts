import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  let body: { secret?: string } = {};
  try { body = await req.json(); } catch { /* empty body ok */ }

  if (secret) {
    if (!body.secret || body.secret !== secret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  try {
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
    const res = await fetch(`${baseUrl}/api/index`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${secret || ''}` },
    });
    const data = await res.json() as Record<string, unknown>;
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: 'Internal error', success: false }, { status: 500 });
  }
}
