import { type NextRequest } from 'next/server';
import { PVE_SESSION_COOKIE, parsePveSession } from '@/app/lib/pve-session';
import { proxmoxUrl, requestTimeout, requireSameOrigin, upstreamError, upstreamHeaders } from '@/app/lib/proxmox-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ path: string[] }> };

async function proxyRequest(request: NextRequest, { params }: Context) {
  const session = parsePveSession(request.cookies.get(PVE_SESSION_COOKIE)?.value);
  if (!session) return Response.json({ error: 'Authentication required' }, { status: 401 });
  if (!['GET', 'HEAD'].includes(request.method)) {
    const rejected = requireSameOrigin(request);
    if (rejected) return rejected;
  }
  const { path } = await params;
  if (!path.length || path.some((segment) => !segment || segment === '.' || segment === '..' || /[\\\r\n\0]/.test(segment))) {
    return Response.json({ error: 'Invalid API path' }, { status: 400 });
  }
  try {
    const headers = upstreamHeaders(session, request.method);
    for (const name of ['content-type', 'range', 'if-range']) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }
    // Stream uploads and downloads. Never replay state-changing operations after an ambiguous failure.
    const uploading = request.headers.get('content-type')?.startsWith('multipart/form-data');
    const timeout = uploading ? Number(process.env.PROXMOX_UPLOAD_TIMEOUT_MS || 7200000) : Number(process.env.PROXMOX_REQUEST_TIMEOUT_MS || 60000);
    const options: RequestInit & { duplex?: 'half' } = {
      method: request.method, headers, cache: 'no-store', redirect: 'manual',
      signal: requestTimeout(request, Number.isFinite(timeout) && timeout > 0 ? timeout : 60000),
    };
    if (!['GET', 'HEAD'].includes(request.method) && request.body) { options.body = request.body; options.duplex = 'half'; }
    const response = await fetch(proxmoxUrl(path.map(encodeURIComponent).join('/') + request.nextUrl.search), options);
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      return Response.json({ error: 'Unexpected Proxmox redirect' }, { status: 502 });
    }
    const responseHeaders = new Headers({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    for (const name of ['content-type', 'content-disposition', 'content-range', 'accept-ranges', 'retry-after']) {
      const value = response.headers.get(name);
      if (value) responseHeaders.set(name, value);
    }
    return new Response(response.body, { status: response.status, headers: responseHeaders });
  } catch (error) { return upstreamError(error); }
}

export const GET = proxyRequest;
export const HEAD = proxyRequest;
export const POST = proxyRequest;
export const PUT = proxyRequest;
export const DELETE = proxyRequest;
export const PATCH = proxyRequest;
