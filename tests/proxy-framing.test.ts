// @vitest-environment node
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import { once } from 'node:events';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPveSession } from '@/app/lib/pve-session';
import { POST, PUT, DELETE } from '@/app/api/proxmox/[...path]/route';

let server: Server;
let received: { headers: IncomingHttpHeaders; body: Buffer }[];
const context = { params: Promise.resolve({ path: ['nodes', 'pve', 'qemu'] }) };
function request(body?: BodyInit, headers: Record<string, string> = {}, method = 'POST') {
  return new NextRequest('http://localhost:3000/api/proxmox/nodes/pve/qemu', {
    method,
    headers: {
      host: 'localhost:3000', origin: 'http://localhost:3000',
      cookie: `pve-session=${createPveSession({ ticket: 'PVE:root@pam:auth', csrfToken: 'csrf', username: 'root@pam' })}`,
      ...headers,
    },
    ...(body === undefined ? {} : { body, duplex: 'half' }),
  });
}
beforeEach(async () => {
  received = [];
  server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk);
    received.push({ headers: req.headers, body: Buffer.concat(chunks) });
    if (req.headers['transfer-encoding']) {
      res.writeHead(501);
      res.end('chunked transfer encoding not supported');
      return;
    }
    res.setHeader('content-type', 'application/json');
    res.end('{"data":"UPID:fixture"}');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No fixture address');
  vi.stubEnv('PROXMOX_HOST', `http://127.0.0.1:${address.port}`);
  vi.stubEnv('APP_ORIGIN', 'http://localhost:3000');
});
afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  vi.unstubAllEnvs();
});

describe('Proxmox HTTP request framing using real Node fetch', () => {
  it.each([
    ['application/x-www-form-urlencoded', 'vmid=101&name=test-vm&cores=2'],
    ['application/json', JSON.stringify({ vmid: 101, description: '한글 VM 설명 😀' })],
  ])('sends %s with its exact byte length even without an incoming length', async (contentType, body) => {
    const response = await POST(request(body, { 'content-type': contentType }), context);
    expect(await response.text()).toContain('UPID:fixture');
    expect(response.status).toBe(200);
    expect(received).toHaveLength(1);
    expect(received[0].headers['content-length']).toBe(String(Buffer.byteLength(body)));
    expect(received[0].headers['transfer-encoding']).toBeUndefined();
    expect(received[0].body.toString()).toBe(body);
  });
  it.each([['POST', POST], ['PUT', PUT], ['DELETE', DELETE]] as const)('handles empty %s requests without chunked encoding', async (method, handler) => {
    expect((await handler(request(undefined, {}, method), context)).status).toBe(200);
    expect(received[0].headers['transfer-encoding']).toBeUndefined();
    expect(received[0].body.byteLength).toBe(0);
  });
  it('streams a multipart upload with its original length and exact bytes', async () => {
    const bytes = Buffer.concat([
      Buffer.from('--boundary\r\nContent-Disposition: form-data; name="filename"; filename="test.iso"\r\n\r\n'),
      Buffer.alloc(2 * 1024 * 1024, 255), Buffer.from('\r\n--boundary--\r\n'),
    ]);
    const response = await POST(request(bytes, {
      'content-type': 'multipart/form-data; boundary=boundary', 'content-length': String(bytes.length),
    }), context);
    expect(response.status).toBe(200);
    expect(received[0].headers['content-length']).toBe(String(bytes.length));
    expect(received[0].headers['transfer-encoding']).toBeUndefined();
    expect(received[0].body).toEqual(bytes);
  });
  it('preserves a known-length VM creation body without re-encoding it', async () => {
    const body = 'vmid=101&description=%ED%95%9C%EA%B8%80&cores=2';
    expect((await POST(request(body, { 'content-length': String(Buffer.byteLength(body)), 'content-type': 'application/x-www-form-urlencoded' }), context)).status).toBe(200);
    expect(received[0].body.toString()).toBe(body);
    expect(received[0].headers['transfer-encoding']).toBeUndefined();
  });
  it.each(['POST', 'PUT', 'DELETE'])('handles an empty input stream for %s', async method => {
    const body = new ReadableStream({ start(controller) { controller.close(); } });
    expect((await POST(request(body, {}, method), context)).status).toBe(200);
    expect(received[0].headers['transfer-encoding']).toBeUndefined();
    expect(received[0].body.length).toBe(0);
  });
  it.each(['-1', 'abc', '1, 1', '9007199254740992', '0'])('rejects invalid or contradictory length %s before a mutation', async length => {
    expect((await POST(request('vmid=101', { 'content-length': length }), context)).status).toBe(400);
    expect(received).toHaveLength(0);
  });
  it('bounds unknown-length buffering and cancels oversized bodies without contacting Proxmox', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream({
      pull(controller) { controller.enqueue(new Uint8Array(65536)); }, cancel,
    });
    const response = await POST(request(body, { 'content-type': 'multipart/form-data; boundary=test' }), context);
    expect(response.status).toBe(411);
    expect(await response.text()).toContain('Content-Length');
    expect(cancel).toHaveBeenCalledOnce();
    expect(received).toHaveLength(0);
  });
  it('times out and cancels a stalled unknown-length body before contacting Proxmox', async () => {
    vi.stubEnv('PROXMOX_REQUEST_TIMEOUT_MS', '20');
    const cancel = vi.fn();
    const response = await POST(request(new ReadableStream({ cancel })), context);
    expect(response.status).toBe(504);
    expect(cancel).toHaveBeenCalledOnce();
    expect(received).toHaveLength(0);
  });
});
