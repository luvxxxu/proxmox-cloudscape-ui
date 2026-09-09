// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as getRealms } from '@/app/api/auth/realms/route';
import { upstreamError } from '@/app/lib/proxmox-server';

function fetchFailure(code: string, message = 'Upstream connection failed') {
  return new TypeError('fetch failed', { cause: Object.assign(new Error(message), { code }) });
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('Proxmox connection diagnostics', () => {
  it.each([
    'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
    'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
    'DEPTH_ZERO_SELF_SIGNED_CERT',
    'SELF_SIGNED_CERT_IN_CHAIN',
  ])('explains how to trust a certificate when fetch fails with %s', async (code) => {
    const response = upstreamError(fetchFailure(code));

    expect(response.status).toBe(502);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ error: expect.stringMatching(/not trusted.*NODE_EXTRA_CA_CERTS.*before starting/i) });
    expect(console.error).toHaveBeenCalledExactlyOnceWith(`[proxmox] Upstream request failed (${code})`);
  });

  it.each([
    ['ERR_TLS_CERT_ALTNAME_INVALID', /does not match PROXMOX_HOST.*certificate SAN/i],
    ['CERT_HAS_EXPIRED', /expired.*renew.*server clock/i],
    ['CERT_NOT_YET_VALID', /not valid yet.*validity dates.*server clock/i],
    ['ENOTFOUND', /resolve.*hostname.*DNS/i],
    ['EAI_AGAIN', /resolve.*hostname.*DNS/i],
    ['ECONNREFUSED', /refused.*port.*API service/i],
    ['EHOSTUNREACH', /unreachable.*routing.*firewall/i],
    ['ENETUNREACH', /unreachable.*routing.*firewall/i],
  ] as const)('distinguishes %s from a CA trust failure', async (code, expected) => {
    const response = upstreamError(fetchFailure(code));

    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body.error).toMatch(expected);
    expect(body.error).not.toContain('NODE_EXTRA_CA_CERTS');
  });

  it.each(['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT'])(
    'returns a gateway timeout for nested %s failures', async (code) => {
      const response = upstreamError(fetchFailure(code));

      expect(response.status).toBe(504);
      expect(await response.json()).toEqual({ error: 'Proxmox request timed out or was cancelled' });
    },
  );

  it.each(['AbortError', 'TimeoutError'])('preserves cancellation handling for %s', async (name) => {
    const response = upstreamError(new DOMException('Private request details', name));

    expect(response.status).toBe(504);
    expect(await response.json()).toEqual({ error: 'Proxmox request timed out or was cancelled' });
  });

  it('finds a connection error inside a fetch AggregateError', async () => {
    const aggregate = new AggregateError([
      new Error('Unknown address failure'),
      Object.assign(new Error('Private IPv6 address'), { code: 'ECONNREFUSED' }),
    ], 'Both addresses failed');
    const response = upstreamError(new TypeError('fetch failed', { cause: aggregate }));

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: expect.stringContaining('refused the connection') });
    expect(console.error).toHaveBeenCalledExactlyOnceWith('[proxmox] Upstream request failed (ECONNREFUSED)');
  });

  it('handles cyclic causes and still inspects independent aggregate failures', async () => {
    const cyclic: { cause?: unknown } = {};
    cyclic.cause = cyclic;
    const response = upstreamError(new AggregateError([cyclic, fetchFailure('ENOTFOUND')]));

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: expect.stringContaining('server DNS settings') });
  });

  it('returns a safe fallback for a closed cause cycle', async () => {
    const cyclic: { cause?: unknown } = {};
    cyclic.cause = cyclic;
    const response = upstreamError(cyclic);

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'Unable to connect to Proxmox. Check server configuration and CA trust.' });
    expect(console.error).toHaveBeenCalledExactlyOnceWith('[proxmox] Upstream request failed (UNKNOWN)');
  });

  it.each(['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'ERR_TLS_CERT_ALTNAME_INVALID', 'PRIVATE_SECRET_CODE'])(
    'keeps raw credentials and certificate details out of responses and logs for %s', async (code) => {
      const privateValues = [
        'https://private-user:private-password@private-host.example:8006',
        'PVE:root@pam:private-ticket',
        '/private/certificates/cluster-root.pem',
        '-----BEGIN CERTIFICATE-----PRIVATE_CERTIFICATE_DATA',
        'PRIVATE_SECRET_CODE',
      ];
      const failure = fetchFailure(code, privateValues.join(' '));
      Object.assign(failure.cause as Error, { cert: { subject: { CN: 'private-host.example' }, raw: privateValues[3] } });
      const response = upstreamError(failure);
      const exposed = `${await response.text()} ${JSON.stringify(vi.mocked(console.error).mock.calls)}`;

      expect(response.status).toBe(502);
      for (const value of privateValues) expect(exposed).not.toContain(value);
      expect(exposed).not.toContain('private-host.example');
      expect(console.error).toHaveBeenCalledExactlyOnceWith(`[proxmox] Upstream request failed (${code === 'PRIVATE_SECRET_CODE' ? 'UNKNOWN' : code})`);
    },
  );

  it('shows the diagnosed CA failure through the authentication realms route', async () => {
    vi.stubEnv('PROXMOX_HOST', 'https://pve.example:8006');
    const mockFetch = vi.fn().mockRejectedValueOnce(fetchFailure('UNABLE_TO_VERIFY_LEAF_SIGNATURE'));
    vi.stubGlobal('fetch', mockFetch);

    const response = await getRealms(new Request('http://localhost:3000/api/auth/realms'));

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: expect.stringContaining('NODE_EXTRA_CA_CERTS') });
    expect(mockFetch).toHaveBeenCalledExactlyOnceWith('https://pve.example:8006/api2/json/access/domains', expect.objectContaining({
      cache: 'no-store', redirect: 'error', signal: expect.any(AbortSignal),
    }));
  });
});
