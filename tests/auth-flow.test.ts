// @vitest-environment node
import { NextRequest } from 'next/server';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { POST as login } from '@/app/api/auth/login/route';
import { POST as renew } from '@/app/api/auth/session/route';
import { POST as startOpenId, GET as finishOpenId } from '@/app/api/auth/openid/route';
import { createPveSession, parsePveSession } from '@/app/lib/pve-session';

const mockFetch = vi.fn();
const valid = { ticket: 'PVE:user@pve:auth-ticket', CSRFPreventionToken: 'csrf-token', username: 'user@pve' };
function request(path: string, body?: unknown, cookies?: string) {
  const headers = new Headers({ host: 'ui.example', origin: 'https://ui.example', 'content-type': 'application/json' });
  if (cookies) headers.set('cookie', cookies);
  return new NextRequest(`https://ui.example${path}`, { method: body ? 'POST' : 'GET', headers, ...(body ? { body: JSON.stringify(body) } : {}) });
}
function cookie(response: Response, name: string) {
  const value = response.headers.get('set-cookie')?.match(new RegExp(`${name}=([^;,]+)`))?.[1];
  if (!value) throw new Error(`Missing cookie ${name}`);
  return `${name}=${value}`;
}
beforeEach(() => {
  vi.stubEnv('APP_ORIGIN', 'https://ui.example');
  vi.stubEnv('PROXMOX_HOST', 'https://pve.example:8006');
  vi.stubGlobal('fetch', mockFetch);
  mockFetch.mockReset();
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('authentication flow', () => {
  it('sets an encrypted HttpOnly session and never sends the CSRF secret to frontend code', async () => {
    mockFetch.mockResolvedValueOnce(Response.json({ data: valid }));
    const response = await login(request('/api/auth/login', { username: 'user', realm: 'pve', password: 'private-password' }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ username: valid.username });
    const header = response.headers.get('set-cookie') || '';
    expect(header).toContain('HttpOnly');
    expect(header).toContain('Secure');
    expect(header).not.toContain('auth-ticket');
    const encrypted = decodeURIComponent(cookie(response, 'pve-session').split('=')[1]);
    expect(parsePveSession(encrypted)).toMatchObject({ username: valid.username, ticket: valid.ticket });
  });
  it('keeps partial TFA authentication out of the session and completes TOTP using the signed challenge', async () => {
    const challenge = `PVE:!tfa!${encodeURIComponent(JSON.stringify({ totp: true, recovery: [1] }))}:signed`;
    mockFetch.mockResolvedValueOnce(Response.json({ data: { ...valid, ticket: challenge } }));
    const first = await login(request('/api/auth/login', { username: 'tfa-user', realm: 'pve', password: 'private-password' }));
    expect(await first.json()).toMatchObject({ secondFactorRequired: true, methods: ['totp', 'recovery'] });
    expect(first.headers.get('set-cookie')).not.toContain('pve-session=');
    mockFetch.mockResolvedValueOnce(Response.json({ data: { ticket: valid.ticket } }));
    const second = await login(request('/api/auth/login', { factor: 'totp', otp: '123456' }, cookie(first, 'pve-login-challenge')));
    expect(second.status).toBe(200);
    expect(mockFetch.mock.calls[1][1].body.get('tfa-challenge')).toBe(challenge);
    expect(mockFetch.mock.calls[1][1].body.get('password')).toBe('totp:123456');
    expect(await second.json()).toEqual({ username: valid.username });
  });
  it('renews the existing user session without needing the account password', async () => {
    const encrypted = createPveSession({ ticket: valid.ticket, csrfToken: valid.CSRFPreventionToken, username: valid.username });
    mockFetch.mockResolvedValueOnce(Response.json({ data: valid }));
    const response = await renew(request('/api/auth/session', {}, `pve-session=${encrypted}`));
    expect(response.status).toBe(200);
    expect(mockFetch.mock.calls[0][1].body.get('password')).toBe(valid.ticket);
    expect(response.headers.get('set-cookie')).toContain('pve-session=');
  });
  it('binds OpenID callback state to the browser that initiated the sign-in', async () => {
    mockFetch.mockResolvedValueOnce(Response.json({ data: 'https://id.example/authorize?state=bound-state' }));
    const first = await startOpenId(request('/api/auth/openid', { realm: 'sso' }));
    expect(first.status).toBe(200);
    const stateCookie = cookie(first, 'pve-openid-state');
    const wrong = await finishOpenId(request('/api/auth/openid?state=wrong&code=code', undefined, stateCookie));
    expect(wrong.headers.get('location')).toBe('https://ui.example/login?openid=failed');
    expect(mockFetch).toHaveBeenCalledTimes(1);
    mockFetch.mockResolvedValueOnce(Response.json({ data: valid }));
    const success = await finishOpenId(request('/api/auth/openid?state=bound-state&code=code', undefined, stateCookie));
    expect(success.headers.get('location')).toBe('https://ui.example/');
    expect(success.headers.get('set-cookie')).toContain('pve-session=');
    expect(mockFetch.mock.calls[1][1].body.get('redirect-url')).toBe('https://ui.example/api/auth/openid');
  });
});
