import { NextRequest, NextResponse } from 'next/server';
import { PVE_SESSION_COOKIE, PVE_SESSION_MAX_AGE, createPveSession, parsePveSession, sessionCookieOptions } from '@/app/lib/pve-session';
import { proxmoxUrl, requestTimeout, requireSameOrigin, upstreamError, upstreamHeaders } from '@/app/lib/proxmox-server';

export async function GET(request: NextRequest) {
  const session = parsePveSession(request.cookies.get(PVE_SESSION_COOKIE)?.value);
  if (!session) return NextResponse.json({ authenticated: false }, { headers: { 'Cache-Control': 'no-store' } });
  try {
    const upstream = await fetch(proxmoxUrl('access/permissions'), { headers: upstreamHeaders(session, 'GET'), cache: 'no-store', redirect: 'error', signal: requestTimeout(request, 15000) });
    await upstream.body?.cancel();
    if (upstream.status === 401) return NextResponse.json({ authenticated: false }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
    if (!upstream.ok) return NextResponse.json({ error: 'Unable to verify Proxmox session' }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
    return NextResponse.json({ username: session.username, authenticated: true, expiresAt: session.expiresAt }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return upstreamError(error); }
}

export async function POST(request: NextRequest) {
  const rejected = requireSameOrigin(request);
  if (rejected) return rejected;
  const session = parsePveSession(request.cookies.get(PVE_SESSION_COOKIE)?.value);
  if (!session) return NextResponse.json({ authenticated: false }, { status: 401 });
  try {
    const upstream = await fetch(proxmoxUrl('access/ticket'), {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ username: session.username, password: session.ticket }),
      cache: 'no-store', redirect: 'error', signal: requestTimeout(request, 30000),
    });
    if (!upstream.ok) { await upstream.body?.cancel(); return Response.json({ error: 'Session renewal failed' }, { status: upstream.status === 401 ? 401 : 502 }); }
    const data = (await upstream.json()).data;
    if (typeof data?.ticket !== 'string' || !data.ticket.startsWith('PVE:') || data.ticket.startsWith('PVE:!tfa!') || typeof data.CSRFPreventionToken !== 'string' || data.username !== session.username) {
      return Response.json({ error: 'Invalid session renewal response' }, { status: 502 });
    }
    const response = NextResponse.json({ authenticated: true, username: session.username, expiresAt: Date.now() + PVE_SESSION_MAX_AGE * 1000 }, { headers: { 'Cache-Control': 'no-store' } });
    response.cookies.set(PVE_SESSION_COOKIE, createPveSession({ ticket: data.ticket, csrfToken: data.CSRFPreventionToken, username: session.username }), sessionCookieOptions());
    return response;
  } catch (error) { return upstreamError(error); }
}
