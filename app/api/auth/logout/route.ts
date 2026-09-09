import { NextResponse } from 'next/server';
import { PVE_SESSION_COOKIE, sessionCookieOptions } from '@/app/lib/pve-session';
import { requireSameOrigin } from '@/app/lib/proxmox-server';

export async function POST(request: Request) {
  const rejected = requireSameOrigin(request);
  if (rejected) return rejected;
  const response = NextResponse.json({ success: true }, { headers: { 'Cache-Control': 'no-store' } });
  for (const name of [PVE_SESSION_COOKIE, 'pve-login-challenge', 'pve-openid-state']) {
    response.cookies.set(name, '', { ...sessionCookieOptions(), maxAge: 0, expires: new Date(0) });
  }
  return response;
}
