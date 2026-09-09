'use client';

interface FetchWithRetryOptions extends RequestInit {
  maxRetries?: number;
  baseDelay?: number;
  retryOn5xx?: boolean;
}

let sessionExpiredHandler: (() => void) | null = null;

export function onSessionExpired(handler: () => void) {
  sessionExpiredHandler = handler;
  return () => { if (sessionExpiredHandler === handler) sessionExpiredHandler = null; };
}

function sleep(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason); return; }
    const abort = () => { clearTimeout(timer); reject(signal?.reason); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
    signal?.addEventListener('abort', abort, { once: true });
  });
}

export async function apiFetch(url: string, options: FetchWithRetryOptions = {}): Promise<Response> {
  const { maxRetries = 2, baseDelay = 1000, retryOn5xx = true, ...fetchOptions } = options;
  const method = (fetchOptions.method || 'GET').toUpperCase();
  // A network error can occur after Proxmox has committed a mutation. Replaying it is unsafe.
  const retries = ['GET', 'HEAD'].includes(method) ? Math.max(0, Math.min(5, maxRetries)) : 0;
  for (let attempt = 0; ; attempt++) {
    if (fetchOptions.signal?.aborted) throw fetchOptions.signal.reason;
    try {
      const response = await fetch(url, { ...fetchOptions, cache: 'no-store' });
      if (response.status === 401) { sessionExpiredHandler?.(); return response; }
      if (attempt >= retries || !retryOn5xx || !(response.status >= 500 || response.status === 429)) return response;
      const retryAfter = response.headers.get('retry-after');
      const seconds = retryAfter ? Number(retryAfter) : NaN;
      const delay = Number.isFinite(seconds) ? Math.min(60000, Math.max(0, seconds * 1000)) : baseDelay * 2 ** attempt + Math.random() * 250;
      await response.body?.cancel();
      await sleep(delay, fetchOptions.signal);
    } catch (error) {
      if (fetchOptions.signal?.aborted || error instanceof Error && error.name === 'AbortError' || attempt >= retries) throw error;
      await sleep(baseDelay * 2 ** attempt + Math.random() * 250, fetchOptions.signal);
    }
  }
}

export async function apiJson<T>(url: string, options: FetchWithRetryOptions = {}): Promise<{ data: T; ok: boolean; status: number }> {
  const response = await apiFetch(url, options);
  const text = await response.text();
  let json;
  try { json = text ? JSON.parse(text) : null; } catch { throw new Error(`Proxmox returned an invalid response (HTTP ${response.status})`); }
  return { data: (json?.data ?? json) as T, ok: response.ok, status: response.status };
}
