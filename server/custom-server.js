/* eslint-disable @typescript-eslint/no-require-imports */
const { createServer } = require('node:http');
const { loadEnvConfig } = require('@next/env');
const next = require('next');
const { createWebSocketRelay } = require('./ws-relay.js');
const { validateConfiguration } = require('./security.js');

const dev = process.env.NODE_ENV !== 'production';
loadEnvConfig(process.cwd(), dev);
try { validateConfiguration(); } catch (error) {
  console.error(`Invalid server configuration: ${error.message}`);
  process.exit(1);
}
const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535');
const hostname = process.env.HOSTNAME || '127.0.0.1';
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();
let shuttingDown = false;

app.prepare().then(() => {
  const server = createServer((req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    if (req.url?.split('?')[0] === '/api/health') {
      res.writeHead(shuttingDown ? 503 : 200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ status: shuttingDown ? 'stopping' : 'ok' }));
      return;
    }
    if (shuttingDown) { res.writeHead(503); res.end('Server is restarting'); return; }
    Promise.resolve(handle(req, res)).catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end('Internal server error');
    });
  });
  server.requestTimeout = 2 * 60 * 60 * 1000;
  server.headersTimeout = 30000;
  const relay = createWebSocketRelay(process.env.PROXMOX_HOST);
  const handleNextUpgrade = app.getUpgradeHandler();
  server.on('upgrade', (req, socket, head) => {
    if (shuttingDown) { socket.destroy(); return; }
    let pathname;
    try { pathname = new URL(req.url || '/', 'http://localhost').pathname; } catch { socket.destroy(); return; }
    if (pathname === '/ws') relay.handleUpgrade(req, socket, head);
    else if (dev) handleNextUpgrade(req, socket, head);
    else socket.destroy();
  });
  server.listen(port, hostname, () => console.log(`Server listening on ${hostname}:${port}`));
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    relay.close();
    const deadline = setTimeout(() => process.exit(1), 30000);
    deadline.unref();
    server.close(async () => {
      await app.close();
      clearTimeout(deadline);
      process.exit(0);
    });
    server.closeIdleConnections();
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
  server.on('error', (error) => { console.error(`Server failed: ${error.code || 'unknown'}`); process.exit(1); });
}).catch(() => {
  console.error('Unable to prepare the application. Verify the production build and server configuration.');
  process.exit(1);
});
