import { randomBytes } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { PVE_SESSION_COOKIE, parsePveSession } from '@/app/lib/pve-session';

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const publicRoute = pathname === '/login' || pathname.startsWith('/api/auth/') || pathname === '/api/health';
  if (!publicRoute && !parsePveSession(request.cookies.get(PVE_SESSION_COOKIE)?.value)) {
    if (pathname.startsWith('/api/')) return NextResponse.json({ error: 'Authentication required' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
    const loginUrl = new URL('/login', process.env.APP_ORIGIN || request.url);
    return NextResponse.redirect(loginUrl);
  }

  const nonce = randomBytes(18).toString('base64');
  const dev = process.env.NODE_ENV !== 'production';
  const origin = new URL(process.env.APP_ORIGIN || request.url);
  const socketOrigin = `${origin.protocol === 'https:' ? 'wss:' : 'ws:'}//${origin.host}`;
  // Next scripts use a fresh nonce. Xterm and existing React layouts generate inline styles.
  const policy = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "img-src 'self' data: blob:",
    `connect-src 'self' ${socketOrigin}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(dev ? [] : ['upgrade-insecure-requests']),
  ].join('; ');
  const headers = new Headers(request.headers);
  headers.set('x-nonce', nonce);
  headers.set('Content-Security-Policy', policy);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set('Content-Security-Policy', policy);
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Referrer-Policy', 'same-origin');
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  response.headers.set('Cache-Control', 'no-store');
  if (!dev) response.headers.set('Strict-Transport-Security', 'max-age=31536000');
  return response;
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] };
