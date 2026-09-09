import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { aggregateRrd, clusterCpuPercent, fetchDashboardData, normalizeNodes, useDashboardData } from '@/app/lib/dashboard-data';
vi.mock('@/app/components/auth-context', () => ({ useAuth: () => ({ authenticated: true }) }));
vi.mock('@/app/components/settings-context', () => ({ useSettings: () => ({ refreshInterval: 0 }) }));
const mockFetch = vi.fn();
beforeEach(() => { vi.stubGlobal('fetch', mockFetch); mockFetch.mockReset(); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('dashboard telemetry', () => {
  it('uses CPU core weighting and tolerates offline nodes with absent metrics', () => {
    const nodes = normalizeNodes([{ node: 'large', status: 'online', cpu: 0.1, maxcpu: 64 }, { node: 'small', status: 'online', cpu: 1, maxcpu: 2 }, { node: 'offline', status: 'offline' }]);
    expect(clusterCpuPercent(nodes)).toBe(13);
    expect(nodes[2]).toMatchObject({ cpu: 0, maxmem: 0, uptime: 0 });
    expect(aggregateRrd([{ cores: 64, points: [{ time: 100, cpu: 0.1, netin: 10 }] }, { cores: 2, points: [{ time: 100, cpu: 1, netin: 5 }] }])[0]).toMatchObject({ time: 100, netin: 15, cpu: 8.4 / 66 });
  });
  it('keeps cluster data available when node history cannot be read', async () => {
    mockFetch.mockImplementation(async (url: string) => url.endsWith('/nodes') ? Response.json({ data: [{ node: 'pve', status: 'online', maxcpu: 2 }] }) : url.includes('/rrddata') ? Response.json({ error: 'Forbidden' }, { status: 403 }) : Response.json({ data: [] }));
    const result = await fetchDashboardData('hour', new AbortController().signal);
    expect(result.nodes).toHaveLength(1);
    expect(result.rrdUnavailable).toEqual(['pve']);
    expect(result.rrd).toEqual([]);
  });
  it('does not lose network-only samples or invent missing CPU values', () => {
    const points = aggregateRrd([{ cores: 2, points: [{ time: 100, netin: 12 }, { time: NaN, cpu: 1 }] }]);
    expect(points).toEqual([{ time: 100, netin: 12 }]);
  });
  it('ignores an older timeframe response after the selection changes', async () => {
    let oldNodes!: (response: Response) => void;
    let nodesRequests = 0;
    mockFetch.mockImplementation((url: string) => {
      if (url.endsWith('/nodes') && nodesRequests++ === 0) return new Promise<Response>(resolve => { oldNodes = resolve; });
      return Promise.resolve(Response.json({ data: url.endsWith('/nodes') ? [{ node: 'new-node', status: 'offline' }] : [] }));
    });
    const { result, unmount } = renderHook(useDashboardData);
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    act(() => result.current.setRrdTimeframe('day'));
    await waitFor(() => expect(result.current.data?.nodes[0].node).toBe('new-node'));
    await act(async () => { oldNodes(Response.json({ data: [{ node: 'old-node', status: 'offline' }] })); });
    expect(result.current.data?.nodes[0].node).toBe('new-node');
    expect(mockFetch.mock.calls[0][1].signal.aborted).toBe(true);
    unmount();
  });
  it('does not schedule periodic requests when refresh is disabled in settings', async () => {
    vi.useFakeTimers();
    mockFetch.mockImplementation(async () => Response.json({ data: [] }));
    const { unmount } = renderHook(useDashboardData);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(mockFetch).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(120000); });
    expect(mockFetch).toHaveBeenCalledTimes(2);
    unmount();
  });
  it('preserves last known data on a manual refresh failure and respects disabled periodic polling', async () => {
    mockFetch.mockImplementation(async () => Response.json({ data: [] }));
    const { result, unmount } = renderHook(useDashboardData);
    await waitFor(() => expect(result.current.data).not.toBeNull());
    const before = result.current.data;
    mockFetch.mockImplementation(async () => Response.json({ error: 'Forbidden' }, { status: 403 }));
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.error).toContain('403'));
    expect(result.current.data).toBe(before);
    expect(result.current.loading).toBe(false);
    unmount();
  });
});
