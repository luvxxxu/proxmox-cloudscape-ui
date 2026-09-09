// @vitest-environment node
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPveSession } from '@/app/lib/pve-session';
import { GET, POST } from '@/app/api/proxmox/[...path]/route';
import { POST as login } from '@/app/api/auth/login/route';
import { POST as consoleSession } from '@/app/api/console/route';
import { isAllowedOrigin } from '@/server/security';

const mockFetch = vi.fn();
function request(path: string, options: { method?: string; authenticated?: boolean; origin?: string; body?: string } = {}) {
  const headers = new Headers({ host: 'localhost:3000' });
  if (options.origin) headers.set('origin', options.origin);
  if (options.authenticated) headers.set('cookie', `pve-session=${createPveSession({ ticket: 'PVE:root@pam:auth', csrfToken: 'csrf', username: 'root@pam' })}`);
  if (options.body) headers.set('content-type', 'application/json');
  return new NextRequest(`http://localhost:3000${path}`, { method: options.method || 'GET', headers, ...(options.body ? { body: options.body } : {}) });
}
const context = { params: Promise.resolve({ path: ['cluster', 'resources'] }) };
beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
  mockFetch.mockReset();
  vi.stubEnv('PROXMOX_HOST', 'https://pve.example:8006');
  vi.stubEnv('PROXMOX_TOKEN_ID', 'root@pam!powerful');
  vi.stubEnv('PROXMOX_TOKEN_SECRET', 'secret');
  vi.stubEnv('APP_ORIGIN', 'http://localhost:3000');
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('authenticated Proxmox gateway', () => {
  it('rejects unauthenticated traffic even when a privileged API token is configured', async () => {
    expect((await GET(request('/api/proxmox/cluster/resources'), context)).status).toBe(401);
    expect(mockFetch).not.toHaveBeenCalled();
  });
  it('rejects missing and cross-site mutation origins before contacting Proxmox', async () => {
    for (const origin of [undefined, 'https://evil.example']) {
      const response = await POST(request('/api/proxmox/cluster/resources', { method: 'POST', authenticated: true, origin }), context);
      expect(response.status).toBe(403);
    }
    expect(mockFetch).not.toHaveBeenCalled();
  });
  it('does not trust a forged forwarding header as the allowed origin', () => {
    expect(isAllowedOrigin('https://evil.example', 'localhost:3000')).toBe(false);
    expect(isAllowedOrigin('http://localhost:3000', 'localhost:3000')).toBe(true);
  });
  it('sends only the logged-in ticket and does not retry mutations', async () => {
    mockFetch.mockResolvedValueOnce(new Response('{"error":"failure"}', { status: 503 }));
    const response = await POST(request('/api/proxmox/cluster/resources', { method: 'POST', authenticated: true, origin: 'http://localhost:3000', body: '{}' }), context);
    expect(response.status).toBe(503);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const options = mockFetch.mock.calls[0][1];
    expect(options.headers.get('Authorization')).toBeNull();
    expect(options.headers.get('Cookie')).toBe('PVEAuthCookie=PVE:root@pam:auth');
    expect(options.headers.get('CSRFPreventionToken')).toBe('csrf');
    expect(options.headers.get('content-length')).toBe('2');
    expect(new TextDecoder().decode(options.body)).toBe('{}');
  });
  it('streams binary data and preserves download metadata', async () => {
    const bytes = new Uint8Array([0, 255, 128, 42]);
    mockFetch.mockResolvedValueOnce(new Response(bytes, { headers: { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename="backup.bin"' } }));
    const response = await GET(request('/api/proxmox/cluster/resources', { authenticated: true }), context);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    expect(response.headers.get('content-disposition')).toContain('backup.bin');
  });
  it('returns a bounded gateway error without leaking upstream internals', async () => {
    mockFetch.mockRejectedValueOnce(new Error('secret-password@example invalid certificate'));
    const response = await GET(request('/api/proxmox/cluster/resources', { authenticated: true }), context);
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain('secret-password');
  });
  it('rejects dot path traversal', async () => {
    const response = await GET(request('/api/proxmox/cluster/resources', { authenticated: true }), { params: Promise.resolve({ path: ['..', 'access'] }) });
    expect(response.status).toBe(400);
    expect(mockFetch).not.toHaveBeenCalled();
  });
  it('handles malformed login JSON and malformed console bodies without 500 errors', async () => {
    const malformed = () => request('/api/auth/login', { method: 'POST', origin: 'http://localhost:3000', body: '{' });
    expect((await login(malformed())).status).toBe(400);
    expect((await consoleSession(request('/api/console', { method: 'POST', origin: 'http://localhost:3000', authenticated: true, body: '{' }))).status).toBe(400);
  });
});
