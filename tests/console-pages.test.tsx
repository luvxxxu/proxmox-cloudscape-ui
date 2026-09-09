import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import NodeShellPage from '@/app/nodes/[node]/shell/page';
const state = vi.hoisted(() => ({ node: 'pve', translation: (key: string) => key, router: { push: vi.fn() } }));
vi.mock('next/navigation', () => ({ useParams: () => ({ node: state.node }), useRouter: () => state.router }));
vi.mock('@/app/lib/use-translation', () => ({ useTranslation: () => ({ t: state.translation }) }));
vi.mock('@/app/components/console-viewer', () => ({ default: () => <div>Console connected</div> }));
const mockFetch = vi.fn();
beforeEach(() => {
  state.node = 'pve'; state.translation = key => key;
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
  vi.stubGlobal('fetch', mockFetch); mockFetch.mockReset();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe('console page connection lifecycle', () => {
  it('keeps a console connection when only UI language changes', async () => {
    mockFetch.mockImplementation(async () => Response.json({ ticket: 'console-ticket', port: 5901, user: 'user@pve' }));
    const { rerender } = render(<NodeShellPage />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    state.translation = key => `translated ${key}`;
    rerender(<NodeShellPage />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
  });
  it('aborts an in-flight console allocation when leaving its page', async () => {
    mockFetch.mockImplementation(() => new Promise(() => {}));
    const { unmount } = render(<NodeShellPage />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    unmount();
    expect(mockFetch.mock.calls[0][1].signal.aborted).toBe(true);
  });
});
