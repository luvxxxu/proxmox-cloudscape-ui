import type { NextRequest } from 'next/server';
import { getConsoleProxyEndpoint, parseConsoleMode, parseConsolePort } from './console-session';
import { PVE_SESSION_COOKIE, parsePveSession } from './pve-session';
import { proxmoxUrl, readJsonObject, requestTimeout, requireSameOrigin, upstreamError, upstreamHeaders } from './proxmox-server';

export async function createConsole(request: NextRequest, nodeOnly: boolean) {
  const rejected = requireSameOrigin(request);
  if (rejected) return rejected;
  const session = parsePveSession(request.cookies.get(PVE_SESSION_COOKIE)?.value);
  if (!session) return Response.json({ error: 'Authentication required' }, { status: 401 });
  const body = await readJsonObject(request);
  const mode = parseConsoleMode(body?.mode);
  const node = body?.node;
  const vmtype = nodeOnly ? 'node' : body?.vmtype;
  const vmid = body?.vmid;
  if (!mode || typeof node !== 'string' || !/^[A-Za-z0-9._-]+$/.test(node)
    || (!nodeOnly && (vmtype !== 'qemu' && vmtype !== 'lxc' || !/^\d+$/.test(String(vmid)) || Number(vmid) < 100))) {
    return Response.json({ error: 'Invalid console request' }, { status: 400 });
  }
  const endpoint = getConsoleProxyEndpoint(vmtype as 'node' | 'qemu' | 'lxc', mode);
  const path = `nodes/${encodeURIComponent(node)}/${nodeOnly ? '' : `${vmtype}/${encodeURIComponent(String(vmid))}/`}${endpoint}`;
  try {
    const headers = upstreamHeaders(session, 'POST');
    headers.set('Content-Type', 'application/x-www-form-urlencoded');
    const response = await fetch(proxmoxUrl(path), { method: 'POST', headers, body: mode === 'novnc' ? 'websocket=1' : '', cache: 'no-store', redirect: 'error', signal: requestTimeout(request, 30000) });
    if (!response.ok) {
      const message = await response.text();
      if (mode === 'xterm' && vmtype === 'qemu' && /serial interface/i.test(message)) {
        return Response.json({ code: 'SERIAL_INTERFACE_REQUIRED', error: 'xterm.js requires a configured QEMU serial interface' }, { status: 409 });
      }
      return Response.json({ error: `Proxmox console request failed (HTTP ${response.status})` }, { status: response.status });
    }
    const data = (await response.json()).data;
    const port = parseConsolePort(data?.port);
    if (typeof data?.ticket !== 'string' || port === null) return Response.json({ error: 'Invalid Proxmox console response' }, { status: 502 });
    return Response.json({ ticket: data.ticket, port, user: typeof data.user === 'string' ? data.user : session.username, ...(typeof data.password === 'string' ? { password: data.password } : {}) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return upstreamError(error); }
}
