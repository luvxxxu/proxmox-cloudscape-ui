import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseSettings, SettingsProvider, useSettings } from '@/app/components/settings-context';
vi.mock('@cloudscape-design/global-styles', () => ({ applyMode: vi.fn(), applyDensity: vi.fn(), Mode: { Dark: 'dark', Light: 'light' }, Density: { Compact: 'compact', Comfortable: 'comfortable' } }));
const saved = new Map<string, string>();
const storage = {
  getItem: (key: string) => saved.get(key) ?? null,
  setItem: (key: string, value: string) => { saved.set(key, value); },
  clear: () => saved.clear(),
};
beforeEach(() => { vi.stubGlobal("localStorage", storage); });
afterEach(() => { saved.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe('persisted settings', () => {
  it('accepts only documented values and recovers from corrupted storage', () => {
    expect(parseSettings('{')).toMatchObject({ theme: 'dark', refreshInterval: 30 });
    expect(parseSettings(JSON.stringify({ theme: 'evil', language: 'fr', refreshInterval: -1, pageSize: 1e9, confirmPowerActions: 'false' }))).toMatchObject({ theme: 'dark', language: 'en', refreshInterval: 30, pageSize: 20, confirmPowerActions: true });
    expect(parseSettings(JSON.stringify({ language: 'ko', refreshInterval: 0, confirmPowerActions: false }))).toMatchObject({ language: 'ko', refreshInterval: 0, confirmPowerActions: false });
  });
  it('keeps updates active in memory when browser storage is full', () => {
    localStorage.setItem('pve-settings', JSON.stringify({ language: 'en' }));
    const { result, unmount } = renderHook(useSettings, { wrapper: SettingsProvider });
    const write = vi.spyOn(storage, 'setItem').mockImplementation(() => { throw new DOMException('Quota exceeded', 'QuotaExceededError'); });
    act(() => result.current.update('language', 'ko'));
    expect(result.current.language).toBe('ko');
    expect(document.documentElement.lang).toBe('ko');
    write.mockRestore();
    act(() => result.current.reset());
    unmount();
  });
  it('synchronizes valid changes from another tab', () => {
    const { result, unmount } = renderHook(useSettings, { wrapper: SettingsProvider });
    act(() => {
      localStorage.setItem('pve-settings', JSON.stringify({ refreshInterval: 60 }));
      window.dispatchEvent(new StorageEvent('storage', { key: 'pve-settings' }));
    });
    expect(result.current.refreshInterval).toBe(60);
    unmount();
  });
});
