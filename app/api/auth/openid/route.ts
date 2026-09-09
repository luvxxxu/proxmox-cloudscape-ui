import { NextRequest, NextResponse } from 'next/server';
import { seal, unseal } from '@/server/security';
import { createPveSession, PVE_SESSION_COOKIE, sessionCookieOptions } from '@/app/lib/pve-session';
import { proxmoxUrl, readJsonObject, requestTimeout, requireSameOrigin, upstreamError } from '@/app/lib/proxmox-server';

const COOKIE = 'pve-openid-state';
let attempts = 0;
let windowEnds = 0;
function callbackUrl(request: Request) { return `${process.env.APP_ORIGIN || new URL(request.url).origin}/api/auth/openid`; }

export async function POST(request: NextRequest) {
  const rejected = requireSameOrigin(request);
  if (rejected) return rejected;
  if (Date.now() >= windowEnds) { attempts = 0; windowEnds = Date.now() + 60000; }
  if (++attempts > 60) return Response.json({ error: 'Too many sign-in attempts. Try again in one minute.' }, { status: 429, headers: { 'Retry-After': '60' } });
  const body = await readJsonObject(request);
  if (typeof body?.realm !== 'string' || !/^[A-Za-z][A-Za-z0-9._-]{0,31}$/.test(body.realm)) return Response.json({ error: 'Invalid OpenID realm' }, { status: 400 });
  try {
    const upstream = await fetch(proxmoxUrl('access/openid/auth-url'), {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ realm: body.realm, 'redirect-url': callbackUrl(request) }), cache: 'no-store', redirect: 'error', signal: requestTimeout(request, 30000),
    });
    if (!upstream.ok) { await upstream.body?.cancel(); return Response.json({ error: 'OpenID authorization could not be started. Check the realm and redirect URI configuration.' }, { status: 502 }); }
    const data = (await upstream.json()).data;
    const destination = new URL(data);
    const state = destination.searchParams.get('state');
    if (destination.protocol !== 'https:' || !state || state.length > 1024) return Response.json({ error: 'Invalid OpenID authorization response' }, { status: 502 });
    const response = NextResponse.json({ url: destination.toString() }, { headers: { 'Cache-Control': 'no-store' } });
    response.cookies.set(COOKIE, seal({ state, expiresAt: Date.now() + 10 * 60000 }, 'openid-state'), { ...sessionCookieOptions(), maxAge: 600 });
    return response;
  } catch (error) { return upstreamError(error); }
}

export async function GET(request: NextRequest) {
  const pending = unseal(request.cookies.get(COOKIE)?.value, 'openid-state');
  const state = request.nextUrl.searchParams.get('state');
  const code = request.nextUrl.searchParams.get('code');
  const origin = process.env.APP_ORIGIN || new URL(request.url).origin;
  const failed = () => {
    const response = NextResponse.redirect(`${origin}/login?openid=failed`);
    response.cookies.set(COOKIE, '', { ...sessionCookieOptions(), maxAge: 0 });
    response.headers.set('Cache-Control', 'no-store');
    response.headers.set('Referrer-Policy', 'no-referrer');
    return response;
  };
  if (!pending || !state || pending.state !== state || !code || code.length > 4096) return failed();
  try {
    const upstream = await fetch(proxmoxUrl('access/openid/login'), {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ state, code, 'redirect-url': callbackUrl(request) }), cache: 'no-store', redirect: 'error', signal: requestTimeout(request, 30000),
    });
    if (!upstream.ok) { await upstream.body?.cancel(); return failed(); }
    const data = (await upstream.json()).data;
    if (typeof data?.ticket !== 'string' || !data.ticket.startsWith('PVE:') || data.ticket.startsWith('PVE:!tfa!') || typeof data.CSRFPreventionToken !== 'string' || typeof data.username !== 'string') return failed();
    const response = NextResponse.redirect(`${origin}/`);
    response.cookies.set(PVE_SESSION_COOKIE, createPveSession({ ticket: data.ticket, csrfToken: data.CSRFPreventionToken, username: data.username }), sessionCookieOptions());
    response.cookies.set(COOKIE, '', { ...sessionCookieOptions(), maxAge: 0 });
    response.headers.set('Cache-Control', 'no-store');
    response.headers.set('Referrer-Policy', 'no-referrer');
    return response;
  } catch { return failed(); }
}
