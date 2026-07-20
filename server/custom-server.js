/* eslint-disable @typescript-eslint/no-require-imports */
const { createServer } = require("http");
const { loadEnvConfig } = require("@next/env");
const next = require("next");
const { createWebSocketRelay } = require("./ws-relay.js");

const dev = process.env.NODE_ENV !== "production";
loadEnvConfig(process.cwd(), dev);
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const port = parseInt(process.env.PORT || "3000", 10);
const app = next({ dev, hostname: "0.0.0.0", port });
const handle = app.getRequestHandler();

const PROXMOX_HOST = process.env.PROXMOX_HOST ?? "";

app.prepare().then(() => {
  const server = createServer((req, res) => {
    handle(req, res);
  });

  const relay = createWebSocketRelay(PROXMOX_HOST);
  const handleNextUpgrade = app.getUpgradeHandler();

  server.on("upgrade", (req, socket, head) => {
    const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
    if (pathname === "/ws") {
      relay.handleUpgrade(req, socket, head);
    } else {
      handleNextUpgrade(req, socket, head);
    }
  });

  server.listen(port, "0.0.0.0", () => {
    console.log(`> Server listening on port ${port}`);
    console.log("> WebSocket relay available at /ws");
  });
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
