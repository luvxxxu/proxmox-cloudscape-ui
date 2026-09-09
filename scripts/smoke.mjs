import { spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:https';
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { chromium, expect } from '@playwright/test';
import { createProxmoxFixture } from '../tests/fixtures/proxmox.mjs';

const directory = mkdtempSync(path.join(tmpdir(), 'proxmox-ui-smoke-'));
const container = `proxmox-ui-smoke-${process.pid}`;
const image = process.env.SMOKE_IMAGE || 'proxmox-cloudscape-ui:audit';
const artifacts = path.resolve('test-results');
mkdirSync(artifacts, { recursive: true });
function command(bin, args, options = {}) {
  const result = spawnSync(bin, args, { encoding: 'utf8', ...options });
  if (result.status !== 0) throw new Error(`${bin} failed: ${result.stderr || result.stdout}`);
  return result.stdout.trim();
}
function assert(condition, message) { if (!condition) throw new Error(message); }
const listen = server => new Promise(resolve => server.listen(0, '0.0.0.0', () => resolve(server.address().port)));
let browser;
let page;
let passed = false;
let fixture;
let frontend;
try {
  command('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '1', '-keyout', `${directory}/key.pem`, '-out', `${directory}/cert.pem`, '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,DNS:host.docker.internal,IP:127.0.0.1']);
  const tls = { key: readFileSync(`${directory}/key.pem`), cert: readFileSync(`${directory}/cert.pem`) };
  fixture = createProxmoxFixture(tls);
  const fixturePort = await listen(fixture.server);
  let applicationPort;
  frontend = createServer(tls, (request, response) => {
    const upstream = http.request({ host: '127.0.0.1', port: applicationPort, path: request.url, method: request.method, headers: request.headers }, source => { response.writeHead(source.statusCode, source.headers); source.pipe(response); });
    upstream.on('error', () => { response.writeHead(502); response.end(); });
    request.pipe(upstream);
  });
  const frontendPort = await listen(frontend);
  const origin = `https://127.0.0.1:${frontendPort}`;
  command('docker', ['run', '-d', '--name', container, '--add-host', 'host.docker.internal:host-gateway', '-p', '127.0.0.1::3000', '-e', `PROXMOX_HOST=https://host.docker.internal:${fixturePort}`, '-e', `APP_ORIGIN=${origin}`, '-e', `SESSION_SECRET=${randomBytes(32).toString('hex')}`, '-e', 'NODE_EXTRA_CA_CERTS=/run/cert.pem', '-v', `${directory}/cert.pem:/run/cert.pem:ro`, image]);
  applicationPort = Number(command('docker', ['port', container, '3000/tcp']).split(':').at(-1));
  const deadline = Date.now() + 90000;
  while (true) {
    try { if ((await fetch(`http://127.0.0.1:${applicationPort}/api/health`)).ok) break; } catch { /* Waiting for process readiness. */ }
    if (Date.now() > deadline) throw new Error('Container readiness timed out');
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  const denied = await fetch(`http://127.0.0.1:${applicationPort}/api/proxmox/nodes`);
  assert(denied.status === 401, 'Anonymous API access must be denied');
  browser = await chromium.launch({ headless: true });
  // Only this isolated fixture uses an untrusted one-day certificate. Application -> PVE TLS remains strict.
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 1000 } });
  page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const navigation = () => page.locator('nav').filter({ has: page.locator('a[href="/vms"]') });
  const navigationToggle = () => page.getByRole('button', { name: 'Open side navigation', exact: true });
  const assertDesktopNavigation = async () => {
    await expect(page.locator('[data-awsui-app-layout-widget-loaded]')).toHaveAttribute('data-awsui-app-layout-widget-loaded', 'true');
    await expect(navigation().getByRole('link', { name: 'Virtual Machines', exact: true })).toBeVisible();
    await expect(navigation().getByRole('link', { name: 'Permissions', exact: true })).toBeVisible();
    await expect(navigationToggle()).toHaveAttribute('aria-expanded', 'true');
    await expect(navigation()).toBeInViewport({ ratio: 0.5 });
  };
  const captureDesktop = async (filename) => {
    await assertDesktopNavigation();
    await page.screenshot({ path: path.join(artifacts, filename), fullPage: false, animations: 'disabled' });
    await assertDesktopNavigation();
  };
  await page.goto(`${origin}/login`);
  await page.getByLabel('Username', { exact: true }).fill('admin');
  await page.getByLabel('Password', { exact: true }).fill('fixture-password-only');
  await page.getByRole('button', { name: /Realm/ }).click();
  await page.getByRole('option', { name: /\bpve\b/ }).click();
  await page.getByRole('button', { name: /Log in|Sign in/i, exact: true }).click();
  await page.waitForURL(`${origin}/`);
  await page.getByRole('heading', { name: 'Dashboard', exact: true }).waitFor();
  await assertDesktopNavigation();
  await page.getByRole('button', { name: 'Close side navigation', exact: true }).click();
  await expect(navigation()).toBeHidden();
  await expect(navigationToggle()).toHaveAttribute('aria-expanded', 'false');
  await navigationToggle().click();
  await assertDesktopNavigation();
  await captureDesktop('dashboard-desktop.png');
  const cookie = (await context.cookies()).find(cookie => cookie.name === 'pve-session');
  assert(cookie?.secure && cookie.httpOnly && cookie.value.startsWith('v1.'), 'Session cookie must be secure, HttpOnly, and encrypted');
  const csp = await page.evaluate(() => fetch(location.href).then(response => response.headers.get('content-security-policy')));
  assert(csp?.includes("'nonce-") && !csp.includes("script-src 'unsafe-inline'"), 'Production scripts need a CSP nonce');
  await navigation().getByRole('link', { name: 'Permissions', exact: true }).click();
  await page.waitForURL(`${origin}/permissions`);
  await page.getByText('admin@example.test', { exact: true }).waitFor();
  await page.getByRole('button', { name: /Create user/i }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel('User ID', { exact: true }).fill('smoke-user@pve');
  await dialog.getByLabel(/^Password/).fill('fixture-password-creation');
  await dialog.getByRole('button', { name: 'Create', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  await page.getByText('smoke-user@pve', { exact: true }).waitFor();
  assert(fixture.calls.filter(call => call.method === 'POST' && call.path === '/access/users').length === 1, 'User creation must be sent once');
  await page.getByRole('tab', { name: 'Roles', exact: true }).click();
  await page.getByRole('button', { name: /Create role/i }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Role ID', { exact: true }).fill('SmokeRole');
  await dialog.getByRole('button', { name: /Privileges/ }).click();
  await page.getByRole('option', { name: /^VM\.Audit/ }).click();
  await page.keyboard.press('Escape');
  await dialog.getByRole('button', { name: 'Create', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  await page.getByText('SmokeRole', { exact: true }).waitFor();
  await assertDesktopNavigation();
  assert(fixture.calls.some(call => call.path === '/access/roles' && call.params.privs === 'VM.Audit'), 'Role privileges must reach Proxmox');
  await captureDesktop('permissions-desktop.png');
  await page.goto(`${origin}/api-explorer`);
  await page.getByPlaceholder('Search users, Ceph, SDN, certificates, or paths').fill('/version');
  await page.getByRole('link', { name: '/version', exact: true }).click();
  await page.getByRole('button', { name: 'Read', exact: true }).click();
  await page.getByText('Request completed.', { exact: true }).waitFor();
  await assertDesktopNavigation();
  await captureDesktop('api-desktop.png');
  for (const route of ['/vms', '/containers', '/nodes', '/storage', '/network', '/backups', '/firewall', '/cluster/ha', '/cluster/replication', '/cluster/options', '/pools', '/logs', '/settings']) {
    await page.goto(`${origin}${route}`);
    await page.getByRole('heading', { level: 1 }).first().waitFor();
    await page.waitForLoadState('networkidle');
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${origin}/permissions`);
  await page.getByRole('button', { name: /Create user/i }).waitFor();
  await expect(navigationToggle()).toHaveAttribute('aria-expanded', 'false');
  await expect(navigation()).toBeHidden();
  await navigationToggle().click();
  await expect(navigation().getByRole('link', { name: 'API management', exact: true })).toBeVisible();
  await navigation().getByRole('link', { name: 'API management', exact: true }).click();
  await page.waitForURL(`${origin}/api-explorer`);
  await expect(navigation()).toBeHidden();
  await navigationToggle().click();
  await navigation().getByRole('link', { name: 'Permissions', exact: true }).click();
  await page.waitForURL(`${origin}/permissions`);
  await expect(navigation()).toBeHidden();
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'Mobile viewport must not overflow horizontally');
  await page.screenshot({ path: `${artifacts}/permissions-mobile.png`, fullPage: true });
  assert(errors.length === 0, `Browser errors: ${errors.join('\n')}`);
  rmSync(path.join(artifacts, 'failure.png'), { force: true });
  passed = true;
  console.log(JSON.stringify({ ok: true, checks: ['production Node container', 'strict upstream TLS', 'anonymous API denial', 'HTTPS encrypted session', 'CSP hydration', 'desktop navigation visibility and toggle', 'navigation route changes', 'user creation', 'role creation', 'API operation', 'mobile navigation open and close', 'mobile overflow', 'browser console'], upstreamCalls: fixture.calls.length, artifacts }, null, 2));
} finally {
  if (page && !passed) { await page.screenshot({ path: `${artifacts}/failure.png`, fullPage: true }).catch(() => {}); console.log((await page.locator("body").innerText().catch(() => "")).slice(-3000)); }
  await browser?.close();
  frontend?.closeAllConnections(); frontend?.close();
  fixture?.server.closeAllConnections(); fixture?.server.close();
  const logs = spawnSync('docker', ['logs', container], { encoding: 'utf8' });
  if (logs.status === 0) console.log(logs.stdout.trim());
  spawnSync('docker', ['rm', '-f', container], { stdio: 'ignore' });
  rmSync(directory, { recursive: true, force: true });
}
