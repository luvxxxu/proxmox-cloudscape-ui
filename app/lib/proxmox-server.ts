import { isAllowedOrigin } from '@/server/security';
import type { PveSession } from './pve-session';

export function requireSameOrigin(request: Request): Response | null {
  const url = new URL(request.url);
  return isAllowedOrigin(request.headers.get('origin'), request.headers.get('host') || url.host, url.protocol === 'https:')
    ? null
    : Response.json({ error: 'Request origin is not allowed' }, { status: 403 });
}

export function proxmoxUrl(path: string): string {
  const host = process.env.PROXMOX_HOST;
  if (!host) throw new Error('PROXMOX_HOST is not configured');
  const target = new URL(host);
  if (!['https:', ...(process.env.NODE_ENV === 'test' ? ['http:'] : [])].includes(target.protocol)
    || target.username || target.password || target.pathname !== '/' || target.search || target.hash) {
    throw new Error('Invalid PROXMOX_HOST configuration');
  }
  return `${target.origin}/api2/json/${path}`;
}

export function upstreamHeaders(session: PveSession, method: string): Headers {
  const headers = new Headers({ Accept: 'application/json', Cookie: `PVEAuthCookie=${session.ticket}` });
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) headers.set('CSRFPreventionToken', session.csrfToken);
  return headers;
}

export function requestTimeout(request?: Request, milliseconds = 60000): AbortSignal {
  return request ? AbortSignal.any([request.signal, AbortSignal.timeout(milliseconds)]) : AbortSignal.timeout(milliseconds);
}

const untrustedCertificate = 'Proxmox TLS certificate is not trusted. Configure NODE_EXTRA_CA_CERTS with the Proxmox CA certificate before starting the server.';
const connectionErrors = new Map([
  ['UNABLE_TO_VERIFY_LEAF_SIGNATURE', untrustedCertificate],
  ['UNABLE_TO_GET_ISSUER_CERT', untrustedCertificate],
  ['UNABLE_TO_GET_ISSUER_CERT_LOCALLY', untrustedCertificate],
  ['DEPTH_ZERO_SELF_SIGNED_CERT', untrustedCertificate],
  ['SELF_SIGNED_CERT_IN_CHAIN', untrustedCertificate],
  ['CERT_UNTRUSTED', untrustedCertificate],
  ['ERR_TLS_CERT_ALTNAME_INVALID', 'Proxmox TLS certificate does not match PROXMOX_HOST. Use a hostname or IP listed in the certificate SAN.'],
  ['CERT_HAS_EXPIRED', 'Proxmox TLS certificate has expired. Renew the certificate and verify the server clock.'],
  ['CERT_NOT_YET_VALID', 'Proxmox TLS certificate is not valid yet. Check the certificate validity dates and server clock.'],
  ['ENOTFOUND', 'Unable to resolve the Proxmox hostname. Check PROXMOX_HOST and server DNS settings.'],
  ['EAI_AGAIN', 'Unable to resolve the Proxmox hostname. Check PROXMOX_HOST and server DNS settings.'],
  ['ECONNREFUSED', 'Proxmox refused the connection. Check PROXMOX_HOST, its port, and the Proxmox API service.'],
  ['EHOSTUNREACH', 'The Proxmox server is unreachable. Check server routing and firewall settings.'],
  ['ENETUNREACH', 'The Proxmox server is unreachable. Check server routing and firewall settings.'],
]);
const timeoutErrors = new Set(['TimeoutError', 'AbortError', 'ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT']);

export function upstreamError(error: unknown): Response {
  // Node fetch wraps TLS/network errors in `cause`, and dual-stack failures in
  // AggregateError.errors. Inspect bounded causes without exposing raw messages.
  const pending = [error];
  const visited = new Set<unknown>();
  let code: string | undefined;
  for (let index = 0; index < pending.length && index < 16; index++) {
    const current = pending[index];
    if (!current || typeof current !== 'object' || visited.has(current)) continue;
    visited.add(current);
    const details = current as { code?: unknown; name?: unknown; cause?: unknown; errors?: unknown };
    code = [details.code, details.name].find((value): value is string => typeof value === 'string' && (connectionErrors.has(value) || timeoutErrors.has(value)));
    if (code) break;
    pending.push(details.cause);
    if (Array.isArray(details.errors)) pending.push(...details.errors.slice(0, 16));
  }
  const timeout = code !== undefined && timeoutErrors.has(code);
  // Only log known codes: upstream messages may contain hosts or credentials.
  console.error(`[proxmox] Upstream request failed (${code || 'UNKNOWN'})`);
  const message = timeout ? 'Proxmox request timed out or was cancelled'
    : (code && connectionErrors.get(code)) || 'Unable to connect to Proxmox. Check server configuration and CA trust.';
  return Response.json({ error: message }, { status: timeout ? 504 : 502, headers: { 'Cache-Control': 'no-store' } });
}

export async function readJsonObject(request: Request, maxBytes = 16384): Promise<Record<string, unknown> | null> {
  if (!request.headers.get('content-type')?.startsWith('application/json')) return null;
  const reader = request.body?.getReader();
  if (!reader) return null;
  const deadline = setTimeout(() => { void reader.cancel().catch(() => {}); }, 15000);
  let length = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) { await reader.cancel(); return null; }
      chunks.push(value);
    }
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return data && typeof data === 'object' && !Array.isArray(data) ? data : null;
  } catch { return null; } finally { clearTimeout(deadline); }
}
