import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePolling } from '@/app/lib/use-polling';

const mockFetch = vi.fn();
beforeEach(() => { vi.stubGlobal('fetch', mockFetch); mockFetch.mockReset(); });
afterEach(() => vi.unstubAllGlobals());

describe('polling lifecycle', () => {
  it('does not refetch indefinitely when an inline transform changes identity', async () => {
    mockFetch.mockResolvedValue(Response.json({ data: 1 }));
    const { result, rerender, unmount } = renderHook(() => usePolling({ url: '/api/value', interval: 0, transform: (json) => (json as { data: number }).data }));
    await waitFor(() => expect(result.current.data).toBe(1));
    rerender();
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    unmount();
  });
  it('ignores an older request when its URL changes while in flight', async () => {
    let completeOld!: (response: Response) => void;
    mockFetch.mockImplementationOnce(() => new Promise<Response>(resolve => { completeOld = resolve; }));
    mockFetch.mockResolvedValueOnce(Response.json({ data: 'new' }));
    const { result, rerender, unmount } = renderHook(({ url }) => usePolling<string>({ url, interval: 0 }), { initialProps: { url: '/api/old' } });
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    rerender({ url: '/api/new' });
    await waitFor(() => expect(result.current.data).toBe('new'));
    await act(async () => { completeOld(Response.json({ data: 'old' })); });
    expect(result.current.data).toBe('new');
    expect(mockFetch.mock.calls[0][1].signal.aborted).toBe(true);
    unmount();
  });
  it('does not send requests when disabled or the URL is absent', async () => {
    const { result, unmount } = renderHook(() => usePolling({ url: null, enabled: false }));
    act(() => result.current.refresh());
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
    expect(result.current.loading).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
    unmount();
  });
});
