import { NextRequest, NextResponse } from 'next/server';

const rateMap = new Map<string, { count: number; ts: number }>();

function rateLimit(ip: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const entry = rateMap.get(ip);
  if (!entry || now - entry.ts > windowMs) {
    rateMap.set(ip, { count: 1, ts: now });
    return true;
  }
  if (entry.count >= limit) return false;
  entry.count++;
  return true;
}

const SECURITY_HEADERS = {
  'X-DNS-Prefetch-Control': 'on',
  'X-XSS-Protection': '1; mode=block',
  'X-Frame-Options': 'SAMEORIGIN',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
};

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown';

  if (pathname === '/api/index') {
    const secret = process.env.CRON_SECRET;
    if (secret) {
      const authHeader = req.headers.get('authorization') || '';
      const qSecret = req.nextUrl.searchParams.get('secret') || '';
      const vercelCron = req.headers.get('x-vercel-cron') === '1';
      if (authHeader !== `Bearer ${secret}` && qSecret !== secret && !vercelCron) {
        return new NextResponse('Forbidden', { status: 403 });
      }
    }
  }

  if (pathname.startsWith('/api/')) {
    const limit = pathname === '/api/refresh' ? 3 : 60;
    if (!rateLimit(ip, limit, 60_000)) {
      return new NextResponse(
        JSON.stringify({ error: 'Too many requests' }),
        { status: 429, headers: { 'Content-Type': 'application/json' } }
      );
    }
  }

  if (pathname.endsWith('.map') && process.env.NODE_ENV === 'production') {
    return new NextResponse('Not Found', { status: 404 });
  }

  const res = NextResponse.next();
  for (const [key, val] of Object.entries(SECURITY_HEADERS)) {
    res.headers.set(key, val);
  }
  return res;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|public/).*)'],
};
