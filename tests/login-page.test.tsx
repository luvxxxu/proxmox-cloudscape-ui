import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import createWrapper from '@cloudscape-design/components/test-utils/dom';
import LoginPage from '@/app/login/page';

vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock('@/app/lib/use-translation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
const fetchMock = vi.fn();
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('login realm selection', () => {
  it('uses the default realm reported by the server', async () => {
    fetchMock.mockResolvedValue(Response.json({ data: [{ realm: 'pve', type: 'pve', default: 1 }, { realm: 'pam', type: 'pam' }] }));
    const { container } = render(<LoginPage />);
    await waitFor(() => expect(createWrapper(container).findSelect()!.findTrigger().getElement().textContent).toBe('pve'));
    fireEvent.change(screen.getByLabelText('auth.username'), { target: { value: 'alice' } });
    fireEvent.change(screen.getByLabelText('auth.password'), { target: { value: ' password-with-spaces ' } });
    fetchMock.mockResolvedValue(Response.json({ error: 'Invalid credentials' }, { status: 401 }));
    fireEvent.submit(container.querySelector('form')!);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/auth/login', expect.anything()));
    const options = fetchMock.mock.calls.find(([url]) => url === '/api/auth/login')![1];
    expect(JSON.parse(options.body)).toEqual({ username: 'alice', password: ' password-with-spaces ', realm: 'pve' });
  });
  it('does not overwrite an explicit realm choice when a slow response arrives', async () => {
    let resolve!: (response: Response) => void;
    fetchMock.mockImplementation(() => new Promise<Response>(done => { resolve = done; }));
    const { container } = render(<LoginPage />);
    const select = createWrapper(container).findSelect()!;
    select.openDropdown(); select.selectOptionByValue('pve');
    resolve(Response.json({ data: [{ realm: 'pam', type: 'pam', default: 1 }, { realm: 'pve', type: 'pve' }] }));
    await waitFor(() => expect(select.findTrigger().getElement().textContent).toContain('Proxmox VE Authentication'));
    expect(select.findTrigger().getElement().textContent).not.toContain('Linux PAM');
  });
});
