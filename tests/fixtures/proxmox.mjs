import { createServer } from 'node:https';

// Isolated, stateful protocol fixture. This never forwards traffic to a real cluster.
export function createProxmoxFixture(tls) {
  const calls = [];
  const users = [{ userid: 'admin@pve', enable: 1, groups: 'admins', email: 'admin@example.test', tokens: [] }];
  const roles = [{ roleid: 'Administrator', privs: 'Sys.Audit Sys.Modify Permissions.Modify User.Modify VM.Audit VM.Allocate VM.Console', special: 1 }, { roleid: 'PVEAuditor', privs: 'Sys.Audit VM.Audit', special: 1 }];
  const server = createServer(tls, async (request, response) => {
    const url = new URL(request.url, 'https://fixture.test');
    const path = decodeURIComponent(url.pathname.replace('/api2/json', ''));
    let raw = '';
    for await (const chunk of request) raw += chunk;
    const params = new URLSearchParams(raw);
    calls.push({ path, method: request.method, params: Object.fromEntries(params) });
    response.setHeader('content-type', 'application/json');
    const send = (data, status = 200) => { response.statusCode = status; response.end(JSON.stringify({ data })); };
    if (path === '/access/domains') return send([{ realm: 'pve', type: 'pve', default: 1 }, { realm: 'pam', type: 'pam' }]);
    if (path === '/access/ticket') {
      if (params.get('username') !== 'admin@pve' || !['fixture-password-only', 'PVE:admin@pve:ABC::fixture'].includes(params.get('password'))) return send(null, 401);
      return send({ ticket: 'PVE:admin@pve:ABC::fixture', CSRFPreventionToken: 'fixture-csrf-token', username: 'admin@pve' });
    }
    if (!request.headers.cookie?.includes('PVEAuthCookie=PVE:admin@pve:ABC::fixture')) return send(null, 401);
    if (path === '/version') return send({ version: '9.1.0', release: '9.1', repoid: 'fixture' });
    if (path === '/access/permissions') return send({ '/': { 'Sys.Audit': 1, 'Sys.Modify': 1, 'Permissions.Modify': 1, 'User.Modify': 1 } });
    if (path === '/access/roles' && request.method === 'POST') { roles.push({ roleid: params.get('roleid'), privs: params.get('privs'), special: 0 }); return send(null); }
    if (path === '/access/roles') return send(roles);
    if (path === '/access/users' && request.method === 'POST') { users.push({ ...Object.fromEntries(params), enable: 1, tokens: [] }); return send(null); }
    if (path === '/access/users') return send(users);
    if (path.startsWith('/access/users/')) {
      const user = users.find(user => user.userid === path.split('/')[3]);
      if (request.method === 'PUT') { Object.assign(user ?? {}, Object.fromEntries(params)); return send(null); }
      return send(user ?? {});
    }
    if (path === '/access/groups') return send([{ groupid: 'admins', users: 'admin@pve', comment: 'Fixture administrators' }]);
    if (path === '/access/acl' || path === '/access/tfa') return send([]);
    if (path === '/nodes') return send([{ node: 'pve', status: 'online', cpu: 0.1, maxcpu: 8, mem: 1073741824, maxmem: 8589934592, disk: 1073741824, maxdisk: 107374182400, uptime: 1000 }]);
    if (path === '/cluster/resources') return send([{ id: 'qemu/100', type: 'qemu', vmid: 100, node: 'pve', name: 'Fixture VM', status: 'running', cpu: 0.05, maxcpu: 2, mem: 536870912, maxmem: 2147483648, disk: 1073741824, maxdisk: 21474836480 }]);
    if (path.endsWith('/rrddata')) return send(Array.from({ length: 10 }, (_, i) => ({ time: 1788910000 + i * 60, cpu: i / 100, memused: 1073741824, memtotal: 8589934592, netin: 1000, netout: 2000 })));
    if (path.endsWith('/status')) return send({ status: 'stopped', exitstatus: 'OK' });
    if (path === '/cluster/options') return send({ keyboard: 'en-us', language: 'en' });
    if (path.endsWith('/options') || path.endsWith('/config')) return send({});
    return send([]);
  });
  return { server, calls };
}
