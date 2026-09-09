import { SESSION_COOKIE, SESSION_SECONDS, parseSession, seal } from '@/server/security';

export const PVE_SESSION_COOKIE = SESSION_COOKIE;
export const PVE_SESSION_MAX_AGE = SESSION_SECONDS;

export interface PveSession {
  ticket: string;
  csrfToken: string;
  username: string;
  issuedAt: number;
  expiresAt: number;
}

export function parsePveSession(value: string | undefined): PveSession | null {
  return parseSession(value) as PveSession | null;
}

export function createPveSession(value: Pick<PveSession, 'ticket' | 'csrfToken' | 'username'>): string {
  const issuedAt = Date.now();
  return seal({ ...value, issuedAt, expiresAt: issuedAt + PVE_SESSION_MAX_AGE * 1000 });
}

export const sessionCookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production' || process.env.APP_ORIGIN?.startsWith('https://') === true,
  sameSite: 'lax' as const,
  path: '/',
  maxAge: PVE_SESSION_MAX_AGE,
});
