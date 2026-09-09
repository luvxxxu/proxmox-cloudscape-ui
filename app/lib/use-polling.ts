'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '@/app/lib/api-client';

interface UsePollingOptions<T> { url: string | null; interval?: number; enabled?: boolean; transform?: (json: unknown) => T }
interface UsePollingResult<T> { data: T | null; loading: boolean; error: string | null; refresh: () => void; lastUpdated: number | null }

export function usePolling<T>({ url, interval = 30000, enabled = true, transform }: UsePollingOptions<T>): UsePollingResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(Boolean(enabled && url));
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const transformRef = useRef(transform);
  const refreshRef = useRef<() => void>(() => {});
  useEffect(() => { transformRef.current = transform; }, [transform]);
  const refresh = useCallback(() => refreshRef.current(), []);
  useEffect(() => {
    let disposed = false;
    let pending = false;
    const controller = new AbortController();
    const fetchData = async () => {
      if (disposed || pending || !enabled || !url) return;
      pending = true;
      try {
        const response = await apiFetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const json = await response.json();
        if (disposed) return;
        setData(transformRef.current ? transformRef.current(json) : (json.data ?? json) as T);
        setError(null);
        setLastUpdated(Date.now());
      } catch (failure) {
        if (!disposed) setError(failure instanceof Error ? failure.message : 'Fetch failed');
      } finally {
        pending = false;
        if (!disposed) setLoading(false);
      }
    };
    const initial = setTimeout(() => {
      setData(null); setError(null); setLastUpdated(null); setLoading(Boolean(enabled && url));
      void fetchData();
    }, 0);
    refreshRef.current = () => { if (enabled && url && !pending) { setLoading(true); void fetchData(); } };
    const timer = enabled && url && interval > 0 ? setInterval(() => { if (document.visibilityState !== 'hidden') void fetchData(); }, interval) : null;
    const visible = () => { if (document.visibilityState === 'visible') void fetchData(); };
    document.addEventListener('visibilitychange', visible);
    return () => {
      disposed = true; controller.abort(); clearTimeout(initial);
      if (timer) clearInterval(timer);
      document.removeEventListener('visibilitychange', visible);
      refreshRef.current = () => {};
    };
  }, [url, interval, enabled]);
  return { data, loading, error, refresh, lastUpdated };
}
