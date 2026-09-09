import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ApiExplorerPage from '@/app/api-explorer/page';
import type { ApiOperation } from '@/app/lib/proxmox-api-schema';

const trackTask = vi.hoisted(() => vi.fn());
vi.mock('@/app/lib/use-translation', () => ({ useTranslation: () => ({ language: 'en' }) }));
vi.mock('@/app/components/notifications', () => ({ useNotifications: () => ({ trackTask }) }));
const createRole: ApiOperation = { id: 'POST /access/roles', method: 'POST', path: '/access/roles', description: 'Create a role.', parameters: { properties: { roleid: { type: 'string' }, privs: { type: 'string', optional: 1 } } }, permissions: {}, returns: {} };
const version: ApiOperation = { id: 'GET /version', method: 'GET', path: '/version', description: 'Read version.', parameters: { properties: {} }, permissions: {}, returns: {} };
const rawConfig: ApiOperation = { id: 'GET /nodes/{node}/ceph/cfg/raw', method: 'GET', path: '/nodes/{node}/ceph/cfg/raw', description: 'Download configuration.', parameters: { properties: { node: { type: 'string' } } }, permissions: {}, returns: {} };
const catalog = { source: 'https://pve.proxmox.com/pve-docs/api-viewer/apidoc.js', retrievedAt: '2026-09-09T00:00:00Z', sha256: 'a'.repeat(64), operations: [createRole, version, rawConfig] };
const fetchMock = vi.fn();
const revoke = vi.fn();
const OriginalURL = URL;

let consoleError: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  consoleError = vi.spyOn(console, "error");
  trackTask.mockReset(); fetchMock.mockReset(); revoke.mockReset();
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal('URL', class extends OriginalURL { static createObjectURL() { return 'blob:http://localhost/result'; } static revokeObjectURL = revoke; });
  HTMLElement.prototype.scrollIntoView = vi.fn();
  fetchMock.mockImplementation(async (url: string) => new Response(JSON.stringify(url === '/proxmox-api-schema.json' ? catalog : { data: null }), { headers: { 'content-type': 'application/json' } }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  try {
    // Empty string conditional children create unkeyed Cloudscape spacing wrappers.
    expect(consoleError.mock.calls.filter(([message]: unknown[]) => String(message).includes('unique "key"'))).toEqual([]);
  } finally {
    consoleError.mockRestore();
  }
});

async function openRole() {
  render(<ApiExplorerPage />);
  fireEvent.click(await screen.findByRole('link', { name: '/access/roles' }));
  fireEvent.change(screen.getByLabelText('roleid'), { target: { value: 'Reader' } });
}

describe('API explorer lifecycle', () => {
  it('confirms dirty operation switching and preserves inputs when the user stays', async () => {
    await openRole();
    fireEvent.click(screen.getByRole('link', { name: '/version' }));
    expect(screen.getByRole('dialog', { name: 'Leave the current operation?' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(screen.getByLabelText('roleid')).toHaveValue('Reader');
    const unload = new Event('beforeunload', { cancelable: true });
    expect(window.dispatchEvent(unload)).toBe(false);
    fireEvent.click(screen.getByRole('link', { name: '/version' }));
    fireEvent.click(screen.getByRole('button', { name: 'Discard and leave' }));
    expect(screen.getByRole('heading', { name: 'GET /version' })).toBeInTheDocument();
  });

  it('keeps a mutation mounted until its response arrives and tracks its task', async () => {
    let resolveRequest: ((response: Response) => void) | undefined;
    fetchMock.mockImplementation((url: string) => url === '/proxmox-api-schema.json' ? Promise.resolve(new Response(JSON.stringify(catalog))) : new Promise<Response>(resolve => { resolveRequest = resolve; }));
    await openRole();
    fireEvent.click(screen.getByRole('button', { name: 'Review request' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Execute' }));
    fireEvent.click(screen.getByRole('link', { name: '/version' }));
    expect(screen.getByText(/The current request is pending/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'POST /access/roles' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const upid = 'UPID:pve:0001:0002:0003:test:100:root@pam:';
    resolveRequest!(new Response(JSON.stringify({ data: upid }), { headers: { 'content-type': 'application/json' } }));
    await waitFor(() => expect(trackTask).toHaveBeenCalledWith(upid, 'pve', 'POST /access/roles'));
    expect(await screen.findByText(/Task accepted/)).toBeInTheDocument();
  });

  it('expands additional fields and displays every validation error', async () => {
    await openRole();
    fireEvent.click(screen.getByRole('button', { name: 'Indexed devices and additional parameters' }));
    fireEvent.change(screen.getByLabelText('Parameters'), { target: { value: '{"unknown":true}' } });
    fireEvent.click(screen.getByRole('button', { name: 'Review request' }));
    expect(screen.getByText('Input errors')).toBeInTheDocument();
    expect(screen.getAllByText(/Unknown parameter: unknown/).length).toBeGreaterThan(0);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([url]) => url.startsWith('/api/proxmox'))).toHaveLength(0);
  });

  it('redacts raw scalar responses until explicitly revealed', async () => {
    fetchMock.mockImplementation(async (url: string) => new Response(JSON.stringify(url === '/proxmox-api-schema.json' ? catalog : { data: 'raw-sensitive-secret' }), { headers: { 'content-type': 'application/json' } }));
    render(<ApiExplorerPage />);
    fireEvent.click(await screen.findByRole('link', { name: '/version' }));
    fireEvent.click(screen.getByRole('button', { name: 'Read' }));
    const response = await screen.findByLabelText('API response');
    expect((response as HTMLTextAreaElement).value).not.toContain('raw-sensitive-secret');
    fireEvent.click(screen.getByRole('button', { name: 'Reveal sensitive values' }));
    expect((response as HTMLTextAreaElement).value).toContain('raw-sensitive-secret');
  });

  it('uses the attachment filename and revokes the downloaded object URL when leaving', async () => {
    fetchMock.mockImplementation(async (url: string) => url === '/proxmox-api-schema.json' ? new Response(JSON.stringify(catalog)) : new Response('config', { headers: { 'content-type': 'text/plain', 'content-disposition': 'attachment; filename="ceph.conf"' } }));
    render(<ApiExplorerPage />);
    fireEvent.click(await screen.findByRole('link', { name: '/nodes/{node}/ceph/cfg/raw' }));
    fireEvent.change(screen.getByLabelText('node'), { target: { value: 'pve' } });
    fireEvent.click(screen.getByRole('button', { name: 'Read' }));
    const download = await screen.findByRole('link', { name: 'Save file' });
    expect(download).toHaveAttribute('download', 'ceph.conf');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.click(screen.getByRole('button', { name: 'Discard and leave' }));
    expect(revoke).toHaveBeenCalledWith('blob:http://localhost/result');
  });
});
