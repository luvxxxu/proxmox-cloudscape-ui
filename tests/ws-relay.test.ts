// @vitest-environment node
import { createPveSession } from "@/app/lib/pve-session";
import { createServer, type Server } from "node:http";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket, WebSocketServer } from "ws";

const require = createRequire(import.meta.url);
const {
  buildProxmoxWebSocketUrl,
  createWebSocketRelay,
  parseSessionTicket,
} = require("../server/ws-relay.js") as {
  buildProxmoxWebSocketUrl: (host: string, params: Record<string, string>) => string;
  createWebSocketRelay: (host: string) => {
    handleUpgrade: (request: unknown, socket: unknown, head: Buffer) => void;
    close: () => void;
  };
  parseSessionTicket: (cookie: string) => string | null;
};

const servers: Server[] = [];

function listen(server: Server): Promise<number> {
  servers.push(server);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Missing server address");
      resolve(address.port);
    });
  });
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
    server.close(() => resolve());
  })));
});

describe("WebSocket relay", () => {
  it("builds the correct Proxmox endpoint and encodes the ticket", () => {
    const url = buildProxmoxWebSocketUrl("https://pve.example:8006", {
      node: "pve-1",
      vmid: "101",
      type: "qemu",
      ticket: "PVEVNC:+/==",
      port: "5901",
    });

    expect(url).toBe(
      "wss://pve.example:8006/api2/json/nodes/pve-1/qemu/101/vncwebsocket?port=5901&vncticket=PVEVNC%3A%2B%2F%3D%3D",
    );
  });

  it("reads the Proxmox auth ticket from the encoded session cookie", () => {
    const session = encodeURIComponent(createPveSession({ ticket: "PVE:root@pam:secret", username: "root@pam", csrfToken: "csrf" }));
    expect(parseSessionTicket(`other=value; pve-session=${session}`)).toBe("PVE:root@pam:secret");
    expect(parseSessionTicket("pve-session=invalid-json")).toBeNull();
  });

  it("buffers terminal authentication until the upstream socket opens", async () => {
    const upstreamServer = createServer();
    const upstreamWss = new WebSocketServer({ noServer: true });
    let upstreamCookie = "";

    upstreamServer.on("upgrade", (request, socket, head) => {
      setTimeout(() => {
        upstreamWss.handleUpgrade(request, socket, head, (websocket) => {
          upstreamCookie = request.headers.cookie ?? "";
          websocket.once("message", (message) => {
            const payload = Buffer.isBuffer(message)
              ? message
              : Array.isArray(message)
                ? Buffer.concat(message)
                : Buffer.from(message);
            websocket.send(Buffer.concat([Buffer.from("OK"), payload]));
          });
        });
      }, 50);
    });
    const upstreamPort = await listen(upstreamServer);

    const relayServer = createServer();
    const relay = createWebSocketRelay(`http://127.0.0.1:${upstreamPort}`);
    relayServer.on("upgrade", (request, socket, head) => relay.handleUpgrade(request, socket, head));
    const relayPort = await listen(relayServer);

    const authTicket = "PVE:root@pam:auth";
    const sessionCookie = encodeURIComponent(createPveSession({ ticket: authTicket, username: "root@pam", csrfToken: "csrf" }));
    const client = new WebSocket(
      `ws://127.0.0.1:${relayPort}/ws?node=pve-1&type=shell&ticket=terminal-ticket&port=5901`,
      "binary",
      {
        headers: {
          Cookie: `pve-session=${sessionCookie}`,
          Origin: `http://127.0.0.1:${relayPort}`,
        },
      },
    );

    const response = await new Promise<string>((resolve, reject) => {
      client.once("open", () => client.send("root@pam:terminal-ticket\n"));
      client.once("message", (message) => resolve(message.toString()));
      client.once("error", reject);
    });

    expect(response).toBe("OKroot@pam:terminal-ticket\n");
    expect(upstreamCookie).toBe(`PVEAuthCookie=${authTicket}`);

    client.close();
    upstreamWss.close();
    relay.close();
  });
});
