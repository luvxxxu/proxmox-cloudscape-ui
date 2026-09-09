// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPveSession, parsePveSession } from '@/app/lib/pve-session';

const session = { ticket: 'PVE:root@pam:12345::abc', csrfToken: 'csrf-token-123', username: 'root@pam' };
afterEach(() => vi.useRealTimers());
describe('authenticated encrypted Proxmox sessions', () => {
  it('does not trust unsigned JSON, malformed input, or an absent cookie', () => {
    for (const value of [undefined, '', 'not-json', JSON.stringify(session)]) expect(parsePveSession(value)).toBeNull();
  });
  it('round trips a valid session without disclosing credentials in the cookie', () => {
    const cookie = createPveSession(session);
    expect(cookie).not.toContain('root');
    expect(parsePveSession(cookie)).toMatchObject(session);
  });
  it('rejects tampered ciphertext', () => {
    const parts = createPveSession(session).split('.');
    parts[2] = (parts[2][0] === 'A' ? 'B' : 'A') + parts[2].slice(1);
    expect(parsePveSession(parts.join('.'))).toBeNull();
  });
  it('rejects expired sessions and partial two-factor tickets', () => {
    vi.useFakeTimers();
    const cookie = createPveSession(session);
    vi.advanceTimersByTime(2 * 60 * 60 * 1000);
    expect(parsePveSession(cookie)).toBeNull();
    expect(parsePveSession(createPveSession({ ...session, ticket: 'PVE:!tfa!challenge' }))).toBeNull();
  });
  it('rejects a session sealed under another key', () => {
    const cookie = createPveSession(session);
    const previous = process.env.SESSION_SECRET;
    process.env.SESSION_SECRET = 'different-secret-at-least-32-characters';
    try { expect(parsePveSession(cookie)).toBeNull(); } finally { process.env.SESSION_SECRET = previous; }
  });
});
