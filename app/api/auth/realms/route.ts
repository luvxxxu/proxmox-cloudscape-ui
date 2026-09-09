import { proxmoxUrl, requestTimeout, upstreamError } from '@/app/lib/proxmox-server';

export async function GET(request: Request) {
  try {
    const response = await fetch(proxmoxUrl('access/domains'), { cache: 'no-store', redirect: 'error', signal: requestTimeout(request, 15000) });
    if (!response.ok) { await response.body?.cancel(); return Response.json({ error: 'Unable to load authentication realms' }, { status: 502 }); }
    const data = (await response.json()).data;
    if (!Array.isArray(data)) return Response.json({ error: 'Invalid realm response' }, { status: 502 });
    return Response.json({ data: data.map((realm: Record<string, unknown>) => ({ realm: realm.realm, type: realm.type, comment: realm.comment, default: realm.default })) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return upstreamError(error); }
}
