import { NextRequest, NextResponse } from 'next/server';
import { PVE_SESSION_COOKIE, createPveSession, sessionCookieOptions } from '@/app/lib/pve-session';
import { proxmoxUrl, readJsonObject, requestTimeout, requireSameOrigin, upstreamError } from '@/app/lib/proxmox-server';
import { seal, unseal } from '@/server/security';

const TFA_COOKIE = 'pve-login-challenge';
const attempts = new Map<string, { count: number; until: number }>();

function rateLimited(username: string): boolean {
  const now = Date.now();
  for (const [key, value] of attempts) if (value.until <= now) attempts.delete(key);
  for (const key of ['*', username.toLowerCase()]) {
    const record = attempts.get(key) || { count: 0, until: now + 60000 };
    record.count++;
    attempts.set(key, record);
    if (record.count > (key === '*' ? 100 : 10)) return true;
  }
  return false;
}

export async function POST(request: NextRequest) {
  const rejected = requireSameOrigin(request);
  if (rejected) return rejected;
  const body = await readJsonObject(request);
  if (!body) return Response.json({ error: 'A valid JSON login request is required' }, { status: 400 });
  const challenge = unseal(request.cookies.get(TFA_COOKIE)?.value, 'login-challenge');
  const secondFactor = typeof body.otp === 'string' && typeof body.factor === 'string';
  const username = secondFactor ? challenge?.username : typeof body.username === 'string' ? body.username.trim() : '';
  const realm = typeof body.realm === 'string' ? body.realm.trim() : '';
  if (!username || typeof username !== 'string' || username.length > 64) return Response.json({ error: 'A valid username is required' }, { status: 400 });
  if (rateLimited(username)) return Response.json({ error: 'Too many login attempts. Try again in one minute.' }, { status: 429, headers: { 'Retry-After': '60' } });
  const form = new URLSearchParams();
  if (secondFactor) {
    if (!challenge || !['totp', 'recovery', 'yubico', 'webauthn'].includes(String(body.factor)) || !body.otp || String(body.otp).length > (body.factor === 'webauthn' ? 10000 : 512)) {
      return Response.json({ error: 'Login challenge expired or invalid. Sign in again.' }, { status: 400 });
    }
    form.set('username', username);
    form.set('tfa-challenge', challenge.ticket);
    form.set('password', `${body.factor}:${String(body.otp).trim()}`);
  } else {
    if (!realm || !/^[A-Za-z][A-Za-z0-9._-]{0,31}$/.test(realm) || typeof body.password !== 'string' || !body.password || body.password.length > 4096 || /[@\r\n\0]/.test(username)) {
      return Response.json({ error: 'Username, password, and realm are required' }, { status: 400 });
    }
    form.set('username', `${username}@${realm}`);
    form.set('password', body.password);
    form.set('new-format', '1');
  }
  try {
    const upstream = await fetch(proxmoxUrl('access/ticket'), {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: form, cache: 'no-store', redirect: 'error', signal: requestTimeout(request, 30000),
    });
    if (!upstream.ok) {
      await upstream.body?.cancel();
      return Response.json({ error: upstream.status >= 500 ? 'Proxmox authentication service is unavailable' : 'Invalid credentials or verification code' }, { status: upstream.status >= 500 ? 502 : 401 });
    }
    const data = (await upstream.json()).data;
    if (typeof data?.ticket !== 'string') return Response.json({ error: 'Invalid Proxmox login response' }, { status: 502 });
    if (data.ticket.startsWith('PVE:!tfa!')) {
      const available = JSON.parse(decodeURIComponent(data.ticket.split(':')[1].slice('!tfa!'.length)));
      const methods = ['totp', 'recovery', 'yubico', 'webauthn'].filter((method) => available[method] && (!Array.isArray(available[method]) || available[method].length));
      if (!methods.length) return Response.json({ error: 'No supported second factor is available. Configure WebAuthn, TOTP, or recovery codes in Proxmox. Legacy U2F requires the native Proxmox interface.' }, { status: 409 });
      if (typeof data.username !== 'string' || typeof data.CSRFPreventionToken !== 'string') return Response.json({ error: 'Invalid Proxmox challenge' }, { status: 502 });
      const response = NextResponse.json({ secondFactorRequired: true, methods, ...(available.webauthn ? { webauthn: available.webauthn } : {}) }, { headers: { 'Cache-Control': 'no-store' } });
      response.cookies.set(TFA_COOKIE, seal({ ticket: data.ticket, username: data.username, csrfToken: data.CSRFPreventionToken, expiresAt: Date.now() + 300000 }, 'login-challenge'), { ...sessionCookieOptions(), maxAge: 300 });
      return response;
    }
    if (data.NeedTFA) return Response.json({ error: 'Legacy two-factor authentication requires the native Proxmox interface' }, { status: 409 });
    const csrfToken = data.CSRFPreventionToken || challenge?.csrfToken;
    const authenticatedUsername = data.username || challenge?.username;
    if (!data.ticket.startsWith('PVE:') || typeof csrfToken !== 'string' || typeof authenticatedUsername !== 'string') return Response.json({ error: 'Invalid Proxmox login response' }, { status: 502 });
    const response = NextResponse.json({ username: authenticatedUsername }, { headers: { 'Cache-Control': 'no-store' } });
    response.cookies.set(PVE_SESSION_COOKIE, createPveSession({ ticket: data.ticket, csrfToken, username: authenticatedUsername }), sessionCookieOptions());
    response.cookies.set(TFA_COOKIE, '', { ...sessionCookieOptions(), maxAge: 0 });
    attempts.delete(username.toLowerCase());
    return response;
  } catch (error) { return upstreamError(error); }
}
