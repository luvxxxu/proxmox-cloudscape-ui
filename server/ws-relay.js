/* eslint-disable @typescript-eslint/no-require-imports */
const { WebSocketServer, WebSocket } = require("ws");
const { parseSession, isAllowedOrigin: checkOrigin } = require("./security.js");

const MAX_PENDING_BYTES = 1024 * 1024;

function rejectUpgrade(socket, status, message) {
  console.warn(`[ws-relay] Client WebSocket upgrade rejected: HTTP ${status} ${message}`);
  if (!socket.writable) return;
  socket.end(
    `HTTP/1.1 ${status} ${message}\r\n` +
    "Connection: close\r\n" +
    "Content-Type: text/plain; charset=utf-8\r\n" +
    `Content-Length: ${Buffer.byteLength(message)}\r\n\r\n${message}`,
  );
}

function parseSessionTicket(cookieHeader) {
  if (!cookieHeader) return null;

  for (const cookie of cookieHeader.split(";")) {
    const separator = cookie.indexOf("=");
    if (separator === -1 || cookie.slice(0, separator).trim() !== "pve-session") continue;

    try {
      const value = decodeURIComponent(cookie.slice(separator + 1).trim());
      return parseSession(value)?.ticket ?? null;
    } catch {
      return null;
    }
  }

  return null;
}

function isAllowedOrigin(req) {
  return checkOrigin(req.headers.origin, req.headers.host, Boolean(req.socket?.encrypted));
}

function parseRelayRequest(req) {
  const requestUrl = new URL(req.url ?? "/", "http://localhost");
  const node = requestUrl.searchParams.get("node");
  const vmid = requestUrl.searchParams.get("vmid");
  const type = requestUrl.searchParams.get("type") ?? "qemu";
  const ticket = requestUrl.searchParams.get("ticket");
  const port = requestUrl.searchParams.get("port");

  if (!node || !ticket || !port) throw new Error("Missing required console parameters");
  if (!/^[a-zA-Z0-9._-]+$/.test(node)) throw new Error("Invalid node");
  if (ticket.length > 512) throw new Error("Invalid console ticket");
  if (!/^(59\d{2})$/.test(port)) throw new Error("Invalid console port");
  if (!["shell", "qemu", "lxc"].includes(type)) throw new Error("Invalid console type");
  if (type !== "shell" && (!vmid || !/^\d+$/.test(vmid))) throw new Error("Invalid VM ID");

  return { node, vmid, type, ticket, port };
}

function buildProxmoxWebSocketUrl(proxmoxHost, { node, vmid, type, ticket, port }) {
  const target = new URL(proxmoxHost);
  target.protocol = target.protocol === "http:" ? "ws:" : "wss:";
  const basePath = `/api2/json/nodes/${encodeURIComponent(node)}`;
  target.pathname = type === "shell"
    ? `${basePath}/vncwebsocket`
    : `${basePath}/${type}/${encodeURIComponent(vmid)}/vncwebsocket`;
  target.search = "";
  target.searchParams.set("port", port);
  target.searchParams.set("vncticket", ticket);
  return target.toString();
}

function relayConnection(client, proxmoxHost, params, authTicket) {
  let upstream;
  let upstreamOpen = false;
  let finished = false;
  let pendingBytes = 0;
  const pendingMessages = [];

  const finishClient = (code, reason) => {
    if (finished) return;
    finished = true;
    if (client.readyState === WebSocket.OPEN) client.close(code, String(reason).slice(0, 80));
  };

  try {
    upstream = new WebSocket(buildProxmoxWebSocketUrl(proxmoxHost, params), "binary", {
      headers: { Cookie: `PVEAuthCookie=${authTicket}` },
      rejectUnauthorized: true,
      handshakeTimeout: 15000,
      maxPayload: MAX_PENDING_BYTES,
      perMessageDeflate: false,
    });
  } catch {
    finishClient(1011, "Invalid Proxmox WebSocket configuration");
    return;
  }

  client.on("message", (data, isBinary) => {
    if (upstreamOpen && upstream.readyState === WebSocket.OPEN) {
      if (upstream.bufferedAmount > MAX_PENDING_BYTES * 8) { finishClient(1013, "Console connection is too slow"); upstream.terminate(); return; }
      upstream.send(data, { binary: isBinary });
      return;
    }

    const size = typeof data === "string" ? Buffer.byteLength(data) : data.byteLength;
    pendingBytes += size;
    if (pendingBytes > MAX_PENDING_BYTES) {
      finishClient(1009, "Pending console data limit exceeded");
      upstream.terminate();
      return;
    }
    pendingMessages.push({ data, isBinary });
  });

  upstream.on("open", () => {
    upstreamOpen = true;
    for (const message of pendingMessages) {
      if (upstream.readyState !== WebSocket.OPEN) break;
      upstream.send(message.data, { binary: message.isBinary });
    }
    pendingMessages.length = 0;
    pendingBytes = 0;
  });

  upstream.on("message", (data, isBinary) => {
    if (client.bufferedAmount > MAX_PENDING_BYTES * 8) { finishClient(1013, "Console connection is too slow"); upstream.terminate(); return; }
    if (client.readyState === WebSocket.OPEN) client.send(data, { binary: isBinary });
  });

  upstream.on("unexpected-response", (_request, response) => {
    const status = response.statusCode ?? 502;
    response.resume();
    console.error(`[ws-relay] Proxmox rejected console WebSocket with HTTP ${status}`);
    finishClient(1011, `Proxmox console WebSocket rejected (HTTP ${status})`);
  });

  upstream.on("close", (code, reason) => {
    const clean = code === 1000;
    finishClient(clean ? 1000 : 1011, reason.toString() || "Proxmox console closed");
  });

  upstream.on("error", (error) => {
    if (finished) return;
    console.error(`[ws-relay] Proxmox console connection failed (${error.code || "connection error"})`);
    finishClient(1011, "Proxmox console connection failed");
  });

  client.on("close", () => {
    finished = true;
    if (upstream.readyState === WebSocket.CONNECTING) upstream.terminate();
    else if (upstream.readyState === WebSocket.OPEN) upstream.close(1000, "Client closed");
  });

  client.on("error", () => {
    if (upstream.readyState === WebSocket.CONNECTING || upstream.readyState === WebSocket.OPEN) {
      upstream.terminate();
    }
  });
}

function createWebSocketRelay(proxmoxHost) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PENDING_BYTES, perMessageDeflate: false });
  const heartbeat = setInterval(() => {
    for (const client of wss.clients) {
      if (client.isAlive === false) { client.terminate(); continue; }
      client.isAlive = false;
      client.ping();
    }
  }, 30000);
  heartbeat.unref();

  return {
    handleUpgrade(req, socket, head) {
      if (!isAllowedOrigin(req)) {
        rejectUpgrade(socket, 403, "Forbidden");
        return;
      }

      const authTicket = parseSessionTicket(req.headers.cookie);
      if (!authTicket) {
        rejectUpgrade(socket, 401, "Unauthorized");
        return;
      }

      let params;
      try {
        params = parseRelayRequest(req);
        if (!proxmoxHost) throw new Error("PROXMOX_HOST is not configured");
      } catch (error) {
        rejectUpgrade(socket, 400, error instanceof Error ? error.message : "Invalid request");
        return;
      }

      if (wss.clients.size >= Number(process.env.MAX_CONSOLE_CONNECTIONS || 128)) { rejectUpgrade(socket, 503, "Service Unavailable"); return; }
      wss.handleUpgrade(req, socket, head, (client) => {
        client.isAlive = true;
        client.on("pong", () => { client.isAlive = true; });
        relayConnection(client, proxmoxHost, params, authTicket);
      });
    },
    close() {
      clearInterval(heartbeat);
      for (const client of wss.clients) client.terminate();
      wss.close();
    },
  };
}

module.exports = {
  buildProxmoxWebSocketUrl,
  createWebSocketRelay,
  isAllowedOrigin,
  parseRelayRequest,
  parseSessionTicket,
};
