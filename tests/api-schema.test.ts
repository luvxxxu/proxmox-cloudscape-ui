import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildApiRequest, effectiveParameter, isSecretParameter, parameterDefinition, redactApiData, responseFilename, type ApiCatalog, type ApiOperation } from '@/app/lib/proxmox-api-schema';

const catalog: ApiCatalog = JSON.parse(readFileSync(`${process.cwd()}/public/proxmox-api-schema.json`, 'utf8'));
const operation = (id: string): ApiOperation => {
  const match = catalog.operations.find(item => item.id === id);
  if (!match) throw new Error(`Missing catalog operation: ${id}`);
  return match;
};

describe('complete official Proxmox API catalog', () => {
  it('has unique, structurally valid operations and definitions for every path parameter', () => {
    expect(catalog.operations.length).toBeGreaterThanOrEqual(680);
    expect(new Set(catalog.operations.map(item => item.id)).size).toBe(catalog.operations.length);
    expect(catalog.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(catalog.source).toMatch(/^https:\/\/(?:pve\.proxmox\.com|git\.proxmox\.com)/);
    for (const item of catalog.operations) {
      expect(item.id).toBe(`${item.method} ${item.path}`);
      expect(['GET', 'POST', 'PUT', 'DELETE']).toContain(item.method);
      expect(item.path).toMatch(/^\/(?:access|cluster|nodes|pools|storage|version)/);
      for (const match of item.path.matchAll(/\{([^}]+)\}/g)) expect(parameterDefinition(item, match[1]), `${item.id}: ${match[1]}`).toBeDefined();
    }
  });

  it('includes role, user, SDN, Ceph and certificate operations', () => {
    for (const id of ['POST /access/roles', 'POST /access/users', 'PUT /access/password', 'POST /cluster/sdn/zones', 'POST /cluster/sdn/fabrics/fabric', 'POST /nodes/{node}/ceph/osd', 'POST /nodes/{node}/certificates/custom']) expect(operation(id)).toBeDefined();
  });
});

describe('API request construction', () => {
  it('preserves explicit false/zero and password whitespace while omitting unused values', () => {
    const request = buildApiRequest(operation('POST /access/users'), { userid: 'alice@pve', password: '        ', enable: '0', expire: '0', comment: '' });
    expect(request.errors).toEqual({});
    const params = request.body as URLSearchParams;
    expect(params.get('password')).toBe('        ');
    expect(params.get('enable')).toBe('0');
    expect(params.get('expire')).toBe('0');
    expect(params.has('comment')).toBe(false);
  });

  it('supports explicitly clearing strings in additional parameters', () => {
    const request = buildApiRequest(operation('PUT /access/users/{userid}'), { userid: 'alice@pve' }, '{"comment":"","groups":""}');
    expect(request.errors).toEqual({});
    expect((request.body as URLSearchParams).get('comment')).toBe('');
    expect((request.body as URLSearchParams).has('groups')).toBe(true);
  });

  it('creates an empty privilege role without inventing required privileges', () => {
    const request = buildApiRequest(operation('POST /access/roles'), { roleid: 'NoPrivileges' }, '{"privs":""}');
    expect(request.errors).toEqual({});
    expect((request.body as URLSearchParams).get('privs')).toBe('');
  });

  it('sends indexed devices using concrete documented names', () => {
    const op = operation('PUT /nodes/{node}/qemu/{vmid}/config');
    const request = buildApiRequest(op, { node: 'pve', vmid: '100' }, '{"net0":"virtio,bridge=vmbr0","scsi0":"local-lvm:32"}');
    expect(request.errors).toEqual({});
    expect((request.body as URLSearchParams).get('net0')).toBe('virtio,bridge=vmbr0');
    expect(parameterDefinition(op, 'net[n]')).toBeUndefined();
    expect(buildApiRequest(op, { node: 'pve', vmid: '100' }, '{"net[n]":"bad"}').errors._extra).toMatch(/Unknown/);
    expect(buildApiRequest(op, { node: 'pve', vmid: '100' }, '{"made-up":"bad"}').errors._extra).toMatch(/Unknown/);
  });

  it('encodes array parameters as repeated values and validates each item', () => {
    const op = operation('POST /cluster/bulk-action/guest/start');
    const request = buildApiRequest(op, {}, '{"vms":[100,101]}');
    expect(request.errors).toEqual({});
    expect((request.body as URLSearchParams).getAll('vms')).toEqual(['100', '101']);
    expect(buildApiRequest(op, {}, '{"vms":[99]}').errors.vms).toMatch(/Minimum/);
    expect(buildApiRequest(op, {}, '{"vms":[]}').errors.vms).toMatch(/at least one/);
  });

  it('handles SDN conditional schemas without requiring unrelated protocol properties', () => {
    const op = operation('POST /cluster/sdn/fabrics/fabric');
    expect(buildApiRequest(op, { id: 'fab1', protocol: 'openfabric' }).errors).toEqual({});
    const definition = op.parameters.properties!.redistribute;
    expect(effectiveParameter(definition, { protocol: 'ospf' }).optional).toBeTruthy();
    expect(buildApiRequest(op, { id: 'fab1', protocol: 'openfabric', redistribute: '["source=static"]' }).errors.redistribute).toMatch(/does not apply/);
    expect(buildApiRequest(op, { id: 'fab1', protocol: 'ospf', redistribute: '["source=static"]' }).errors).toEqual({});
  });

  it('flattens HA allOf and tagged oneOf schemas for creation and updates', () => {
    for (const id of ['POST /cluster/ha/rules', 'PUT /cluster/ha/rules/{rule}']) {
      const request = buildApiRequest(operation(id), { rule: 'affinity1', type: 'node-affinity', nodes: 'pve1', resources: 'vm:100' });
      expect(request.errors).toEqual({});
      expect((request.body as URLSearchParams).get('nodes')).toBe('pve1');
    }
    expect(buildApiRequest(operation('POST /cluster/ha/rules'), { rule: 'affinity1', type: 'resource-affinity', nodes: 'pve1', resources: 'vm:100', affinity: 'positive' }).errors.nodes).toMatch(/does not apply/);
  });

  it('applies documented path defaults and safely encodes volume identifiers', () => {
    expect(buildApiRequest(operation('GET /cluster/acme/account/{name}'), {}).url).toBe('/api/proxmox/cluster/acme/account/default');
    const op = operation('GET /nodes/{node}/storage/{storage}/content/{volume}');
    const request = buildApiRequest(op, { node: 'pve', storage: 'local', volume: 'local:iso/debian.iso' });
    expect(request.url).toBe('/api/proxmox/nodes/pve/storage/local/content/local%3Aiso%2Fdebian.iso');
    expect(request.errors).toEqual({});
    expect(buildApiRequest(op, { node: '..', storage: 'local', volume: 'safe' }).errors.node).toBeDefined();
    expect(buildApiRequest(op, { node: '\ud800', storage: 'local', volume: 'safe' }).errors.node).toBeDefined();
  });

  it('rejects invalid numeric syntax, unrecognized fields and prototype keys', () => {
    const op = operation('POST /nodes/{node}/ceph/osd');
    expect(buildApiRequest(op, { node: 'pve', dev: '/dev/sdb', 'osds-per-device': '0x10' }).errors['osds-per-device']).toMatch(/integer/);
    expect(buildApiRequest(op, { node: 'pve', dev: '/dev/sdb' }, '{"__proto__":"bad"}').errors._extra).toMatch(/Invalid parameter/);
  });

  it('does not evaluate Perl regexes or other supplied schema code in the browser', () => {
    const op = { ...operation('POST /access/roles'), parameters: { properties: { roleid: { type: 'string', pattern: '(?{die "never execute"})(a+)+$' } } } };
    expect(buildApiRequest(op, { roleid: 'Reader' }).errors).toEqual({});
  });
});

describe('response privacy and downloads', () => {
  it('redacts named and scalar secrets but preserves useful identifiers', () => {
    expect(isSecretParameter('tokenid')).toBe(false);
    expect(isSecretParameter('full-tokenid')).toBe(false);
    expect(redactApiData({ data: { 'full-tokenid': 'alice@pve!backup', value: 'secret', recovery: ['code'] } }, true)).toEqual({ data: { 'full-tokenid': 'alice@pve!backup', value: '••••••••', recovery: '••••••••' } });
    expect(redactApiData({ data: 'raw-private-key' }, true)).toEqual({ data: '••••••••' });
    expect(redactApiData({ data: 'UPID:pve:123:' }, true)).toEqual({ data: 'UPID:pve:123:' });
    expect(redactApiData({ data: { content: '-----BEGIN PRIVATE KEY----- abc' } }, true)).toEqual({ data: { content: '••••••••' } });
  });
  it('honors encoded attachment filenames and strips path/control characters', () => {
    expect(responseFilename("attachment; filename*=UTF-8''node%20certificate.pem", 'application/octet-stream')).toBe('node certificate.pem');
    expect(responseFilename('attachment; filename="../../node.conf"', 'text/plain')).toBe('node.conf');
    expect(responseFilename('attachment; filename="bad\r\nname.pem"', 'text/plain')).toBe('badname.pem');
    expect(responseFilename(null, 'application/octet-stream')).toBe('proxmox-response.bin');
    expect(responseFilename(null, 'application/x-pem-file')).toBe('proxmox-response.pem');
  });
});
