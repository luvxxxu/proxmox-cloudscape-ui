type FramedBody = { body?: BodyInit; duplex?: 'half' };
const MAX_BUFFERED_BODY = 1024 * 1024;

/** Proxmox rejects chunked requests. Preserve known lengths for large streams,
 * and measure small bodies when an HTTP/2 or streaming client omits the length. */
export async function proxmoxRequestBody(request: Request, headers: Headers, signal: AbortSignal): Promise<FramedBody | Response> {
  const declared = request.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || !Number.isSafeInteger(Number(declared)))) {
    return Response.json({ error: 'Invalid Content-Length' }, { status: 400 });
  }
  if (!request.body) {
    return declared !== null && Number(declared) !== 0
      ? Response.json({ error: 'Request body does not match Content-Length' }, { status: 400 }) : {};
  }
  if (declared !== null && Number(declared) > 0) {
    headers.set('content-length', String(Number(declared)));
    // Node fetch verifies the number of streamed bytes against this length.
    return { body: request.body, duplex: 'half' };
  }

  const reader = request.body.getReader();
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    signal.throwIfAborted();
    while (true) {
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      length += value.byteLength;
      if (declared !== null && length > Number(declared)) {
        return Response.json({ error: 'Request body does not match Content-Length' }, { status: 400 });
      }
      if (length > MAX_BUFFERED_BODY) {
        return Response.json({ error: 'Requests larger than 1 MiB require Content-Length. Send the file with a known size and ensure the reverse proxy preserves Content-Length.' }, { status: 411 });
      }
      chunks.push(value);
    }
    // Empty DELETE requests need no framing header; Node adds zero length for POST/PUT.
    if (length === 0) return {};
    headers.set('content-length', String(length));
    return { body: new Uint8Array(Buffer.concat(chunks, length)) };
  } finally {
    signal.removeEventListener('abort', cancel);
    cancel();
    reader.releaseLock();
  }
}
