// @vitest-environment node
import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { proxy } from '@/proxy';
afterEach(() => vi.unstubAllEnvs());
describe('page authentication and Content Security Policy', () => {
  it('uses a new script nonce on every request and permits Cloudscape fonts and Xterm styles', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('APP_ORIGIN', 'https://ui.example');
    const request = new NextRequest('https://ui.example/login');
    const first = proxy(request);
    const second = proxy(request);
    const policy = first.headers.get('content-security-policy') || '';
    expect(policy).toContain("'nonce-");
    expect(policy).not.toContain('unsafe-eval');
    expect(policy).toContain("font-src 'self' data:");
    expect(policy).toContain("style-src 'self' 'unsafe-inline'");
    expect(policy).toContain('wss://ui.example');
    expect(policy).not.toEqual(second.headers.get('content-security-policy'));
    expect(first.headers.get('strict-transport-security')).toBe('max-age=31536000');
  });
  it('returns API 401 errors as JSON and rejects unsigned cookies for page access', async () => {
    const response = proxy(new NextRequest('http://localhost/api/proxmox/cluster/resources'));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Authentication required' });
    const page = proxy(new NextRequest('http://localhost/vms', { headers: { cookie: 'pve-session=forged' } }));
    expect(page.status).toBe(307);
    expect(page.headers.get('location')).toBe('http://localhost/login');
  });
});
