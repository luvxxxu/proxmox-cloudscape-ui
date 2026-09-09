import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const source = 'https://pve.proxmox.com/pve-docs/api-viewer/apidoc.js';
const input = process.argv[2];
const raw = input ? await readFile(input, 'utf8') : await (async () => {
  const response = await fetch(source, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Schema download failed: HTTP ${response.status}`);
  return response.text();
})();
// Parse the data only. Never execute JavaScript downloaded from the documentation.
const match = raw.match(/(?:const|var|let) apiSchema\s*=\s*(\[[\s\S]*?\n\])\s*;/);
if (!match) throw new Error('Could not locate Proxmox apiSchema JSON');
const tree = JSON.parse(match[1]);
const operations = [];
function visit(nodes) {
  for (const node of nodes) {
    for (const [method, info] of Object.entries(node.info ?? {})) {
      if (!['GET', 'POST', 'PUT', 'DELETE'].includes(method)) continue;
      operations.push({ id: `${method} ${node.path}`, path: node.path, method,
        description: info.description ?? '', permissions: info.permissions ?? {},
        parameters: info.parameters ?? { properties: {} }, returns: info.returns ?? {},
        ...(info.deprecated ? { deprecated: info.deprecated } : {}) });
    }
    visit(node.children ?? []);
  }
}
visit(tree);
operations.sort((a, b) => a.id.localeCompare(b.id));
if (operations.length < 500 || new Set(operations.map(op => op.id)).size !== operations.length) {
  throw new Error('Unexpected or duplicate API operations; refusing to replace schema');
}
await mkdir(new URL('../public/', import.meta.url), { recursive: true });
await writeFile(new URL('../public/proxmox-api-schema.json', import.meta.url), JSON.stringify({
  source, retrievedAt: new Date().toISOString(), sha256: createHash('sha256').update(raw).digest('hex'), operations,
}));
console.log(`Saved ${operations.length} Proxmox API operations`);
