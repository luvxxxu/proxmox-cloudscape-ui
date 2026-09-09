import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from '@/app/components/auth-context';
const { router } = vi.hoisted(() => ({ router: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() } }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
const mockFetch = vi.fn();
beforeEach(() => { vi.stubGlobal('fetch', mockFetch); mockFetch.mockReset(); vi.clearAllMocks(); });
afterEach(() => vi.unstubAllGlobals());
const valid = () => Response.json({ username: 'user@pve', authenticated: true, expiresAt: Date.now() + 6000000 });

describe('authentication UI lifecycle', () => {
  it('shows a retryable session error on backend outage and recovers after retry', async () => {
    mockFetch.mockResolvedValueOnce(Response.json({ error: 'unavailable' }, { status: 502 }));
    const { result, unmount } = renderHook(useAuth, { wrapper: AuthProvider });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.sessionError).toContain('Unable to verify');
    expect(router.replace).not.toHaveBeenCalled();
    mockFetch.mockResolvedValueOnce(valid());
    act(() => result.current.reloadSession());
    await waitFor(() => expect(result.current.authenticated).toBe(true));
    expect(result.current.sessionError).toBeNull();
    unmount();
  });
  it('routes rejected sessions to login instead of showing an empty shell', async () => {
    mockFetch.mockResolvedValueOnce(Response.json({ authenticated: false }, { status: 401 }));
    const { result, unmount } = renderHook(useAuth, { wrapper: AuthProvider });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(router.replace).toHaveBeenCalledWith('/login?expired=1');
    unmount();
  });
  it('does not pretend logout succeeded when the cookie could not be cleared', async () => {
    mockFetch.mockResolvedValueOnce(valid());
    const { result, unmount } = renderHook(useAuth, { wrapper: AuthProvider });
    await waitFor(() => expect(result.current.authenticated).toBe(true));
    mockFetch.mockRejectedValueOnce(new Error('Offline'));
    act(() => result.current.logout());
    await waitFor(() => expect(result.current.logoutError).toContain('still active'));
    expect(result.current.authenticated).toBe(true);
    expect(router.push).not.toHaveBeenCalled();
    unmount();
  });
  it('aborts and settles renewal before logout, blocking focus and duplicate sign-out races', async () => {
    let finishRenewal!: (response: Response) => void;
    let renewalSignal!: AbortSignal;
    mockFetch.mockResolvedValueOnce(Response.json({ username: 'user@pve', authenticated: true, expiresAt: Date.now() + 1000 }));
    mockFetch.mockImplementationOnce((_url, options) => {
      renewalSignal = options.signal;
      // Model response headers already in transit: abort is not enough without
      // waiting for the fetch promise to settle before clearing the cookie.
      return new Promise<Response>(resolve => { finishRenewal = resolve; });
    });
    mockFetch.mockResolvedValueOnce(Response.json({ success: true }));
    const { result, unmount } = renderHook(useAuth, { wrapper: AuthProvider });
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    act(() => {
      result.current.logout();
      result.current.logout();
      window.dispatchEvent(new Event('focus'));
    });
    expect(renewalSignal.aborted).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    await act(async () => { finishRenewal(valid()); });
    await waitFor(() => expect(result.current.authenticated).toBe(false));
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(mockFetch.mock.calls[2][0]).toBe('/api/auth/logout');
    expect(router.push).toHaveBeenCalledWith('/login');
    expect(router.push).not.toHaveBeenCalledWith('/login?expired=1');
    unmount();
  });
  it('cancels an active renewal when its provider unmounts', async () => {
    let renewalSignal!: AbortSignal;
    mockFetch.mockResolvedValueOnce(Response.json({ username: 'user@pve', authenticated: true, expiresAt: Date.now() + 1000 }));
    mockFetch.mockImplementationOnce((_url, options) => {
      renewalSignal = options.signal;
      return new Promise((_resolve, reject) => renewalSignal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }));
    });
    const { unmount } = renderHook(useAuth, { wrapper: AuthProvider });
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    unmount();
    expect(renewalSignal.aborted).toBe(true);
  });
  it('serializes a different tab renewal before logout through the shared browser lock', async () => {
    let finishRenewal!: (response: Response) => void;
    let lockTail: Promise<unknown> = Promise.resolve();
    const lockRequest = vi.fn((_name: string, _options: unknown, action: () => Promise<unknown>) => {
      const pending = lockTail.then(action);
      lockTail = pending.catch(() => undefined);
      return pending;
    });
    vi.stubGlobal('navigator', { locks: { request: lockRequest } });
    const requestOrder: string[] = [];
    mockFetch.mockResolvedValueOnce(Response.json({ username: 'user@pve', authenticated: true, expiresAt: Date.now() + 1000 }));
    mockFetch.mockImplementationOnce(() => {
      requestOrder.push('renew');
      return new Promise<Response>(resolve => { finishRenewal = resolve; });
    });
    const firstTab = renderHook(useAuth, { wrapper: AuthProvider });
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    mockFetch.mockResolvedValueOnce(valid());
    const secondTab = renderHook(useAuth, { wrapper: AuthProvider });
    await waitFor(() => expect(secondTab.result.current.authenticated).toBe(true));
    mockFetch.mockImplementationOnce(() => {
      requestOrder.push('logout');
      return Promise.resolve(Response.json({ success: true }));
    });
    act(() => secondTab.result.current.logout());
    await waitFor(() => expect(lockRequest).toHaveBeenCalledTimes(2));
    expect(requestOrder).toEqual(['renew']);
    await act(async () => { finishRenewal(valid()); });
    await waitFor(() => expect(secondTab.result.current.authenticated).toBe(false));
    expect(requestOrder).toEqual(['renew', 'logout']);
    expect(lockRequest.mock.calls.map(call => call[0])).toEqual(['proxmox-session-cookie', 'proxmox-session-cookie']);
    firstTab.unmount(); secondTab.unmount();
  });
});
