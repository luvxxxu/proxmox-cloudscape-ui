import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationProvider, retainNotifications, useNotifications } from '@/app/components/notifications';

vi.mock('@/app/components/auth-context', () => ({ useAuth: () => ({ user: 'user@pve', authenticated: true }) }));
vi.mock('@/app/lib/use-translation', () => ({ useTranslation: () => ({ language: 'en' }) }));
const mockFetch = vi.fn();
beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal('fetch', mockFetch); mockFetch.mockReset(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
const tick = () => act(async () => { await vi.advanceTimersByTimeAsync(2000); });

describe('task notifications', () => {
  it('deduplicates a task by UPID while retaining different tasks with identical descriptions', async () => {
    mockFetch.mockImplementation(async () => Response.json({ data: { status: 'running' } }));
    const { result, unmount } = renderHook(useNotifications, { wrapper: NotificationProvider });
    act(() => {
      result.current.trackTask('UPID:node:one', 'node', 'VM start');
      result.current.trackTask('UPID:node:one', 'node', 'VM start');
      result.current.trackTask('UPID:node:two', 'node', 'VM start');
    });
    expect(result.current.notifications).toHaveLength(2);
    await tick();
    expect(mockFetch).toHaveBeenCalledTimes(2);
    unmount();
  });
  it('keeps unknown completion visible and only emits finished after an explicit exit status', async () => {
    mockFetch.mockImplementation(async () => Response.json({ data: { status: 'stopped' } }));
    const finished = vi.fn();
    window.addEventListener('proxmox-task-finished', finished);
    const { result, unmount } = renderHook(useNotifications, { wrapper: NotificationProvider });
    act(() => result.current.trackTask('UPID:node:unknown', 'node', 'Backup'));
    await tick(); await tick(); await tick();
    expect(result.current.notifications[0].type).toBe('warning');
    expect(finished).not.toHaveBeenCalled();
    mockFetch.mockImplementation(async () => Response.json({ data: { status: 'stopped', exitstatus: 'disk full' } }));
    await tick(); await tick();
    expect(result.current.notifications[0].type).toBe('error');
    expect(result.current.notifications[0].content).toContain('disk full');
    expect(finished).toHaveBeenCalledTimes(1);
    expect((finished.mock.calls[0][0] as CustomEvent).detail.ok).toBe(false);
    unmount(); window.removeEventListener('proxmox-task-finished', finished);
  });
  it('does not overlap polling or publish old results after provider unmount', async () => {
    let finish!: (response: Response) => void;
    mockFetch.mockImplementation(() => new Promise<Response>(resolve => { finish = resolve; }));
    const completed = vi.fn(); window.addEventListener('proxmox-task-finished', completed);
    const { result, unmount } = renderHook(useNotifications, { wrapper: NotificationProvider });
    act(() => result.current.trackTask('UPID:node:pending', 'node', 'Migration'));
    await tick(); await tick(); await tick();
    expect(mockFetch).toHaveBeenCalledTimes(1);
    unmount();
    await act(async () => { finish(Response.json({ data: { status: 'stopped', exitstatus: 'OK' } })); });
    expect(completed).not.toHaveBeenCalled();
    window.removeEventListener('proxmox-task-finished', completed);
  });
  it('does not evict active tasks or errors when generic history fills up', () => {
    const history = Array.from({ length: 120 }, (_, index) => ({ id: String(index), type: 'success' as const, content: 'Done' }));
    const retained = retainNotifications([...history, { id: 'pending', type: 'in-progress', loading: true }, { id: 'failure', type: 'error' }]);
    expect(retained).toHaveLength(102);
    expect(retained.some(item => item.id === 'pending')).toBe(true);
    expect(retained.some(item => item.id === 'failure')).toBe(true);
  });
});
