import { NextRequest, NextResponse } from 'next/server';

// ─── In-Memory Rate Limiter ────────────────────────────────────────────────────
// Per-IP sliding window — stored in module memory (resets on cold start, fine for free tier)
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

// Clean up old entries every ~500 requests to avoid memory leak
let cleanupCounter = 0;
function maybeCleanup() {
  if (++cleanupCounter % 500 !== 0) return;
  const cutoff = Date.now() - 60_000;
  for (const [key, val] of rateMap) {
    if (val.ts < cutoff) rateMap.delete(key);
  }
}

// ─── Security Headers ─────────────────────────────────────────────────────────
const SECURITY_HEADERS = {
  'X-DNS-Prefetch-Control':       'on',
  'X-XSS-Protection':             '1; mode=block',
  'X-Frame-Options':              'SAMEORIGIN',
  'X-Content-Type-Options':       'nosniff',
  'Referrer-Policy':              'strict-origin-when-cross-origin',
  'Permissions-Policy':           'camera=(), microphone=(), geolocation=()',
  'Strict-Transport-Security':    'max-age=63072000; includeSubDomains; preload',
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self' 'unsafe-eval' 'unsafe-inline'",           // Next.js needs unsafe-eval in dev
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: blob:",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://fullnode.mainnet.sui.io https://api.blockvision.org",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; '),
};

// ─── Middleware ───────────────────────────────────────────────────────────────
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
          || req.headers.get('x-real-ip')
          || 'unknown';

  maybeCleanup();

  // ── Block /api/index from public browsers (only cron + secret) ────────────
  if (pathname === '/api/index') {
    const secret = process.env.CRON_SECRET;
    if (secret) {
      const authHeader = req.headers.get('authorization') || '';
      const qSecret   = req.nextUrl.searchParams.get('secret') || '';
      const vercelCron = req.headers.get('x-vercel-cron') === '1';
      if (
        authHeader !== `Bearer ${secret}` &&
        qSecret    !== secret &&
        !vercelCron
      ) {
        return new NextResponse('Forbidden', { status: 403 });
      }
    }
  }

  // ── Rate limiting on all /api routes ──────────────────────────────────────
  if (pathname.startsWith('/api/')) {
    // Stricter limit on indexer trigger
    const limit  = pathname === '/api/refresh' ? 3 : 60;
    const window = pathname === '/api/refresh' ? 60_000 : 60_000;

    if (!rateLimit(ip, limit, window)) {
      return new NextResponse(
        JSON.stringify({ error: 'Too many requests', retry_after: 60 }),
        {
          status: 429,
          headers: {
            'Content-Type':  'application/json',
            'Retry-After':   '60',
            'X-RateLimit-Limit': String(limit),
          },
        }
      );
    }
  }

  // ── Block source map requests in production ────────────────────────────────
  if (pathname.endsWith('.map') && process.env.NODE_ENV === 'production') {
    return new NextResponse('Not Found', { status: 404 });
  }

  // ── Apply security headers ─────────────────────────────────────────────────
  const res = NextResponse.next();
  for (const [key, val] of Object.entries(SECURITY_HEADERS)) {
    res.headers.set(key, val);
  }

  // Don't index API routes
  if (pathname.startsWith('/api/')) {
    res.headers.set('X-Robots-Tag', 'noindex, nofollow');
  }

  return res;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|public/).*)',
  ],
};
