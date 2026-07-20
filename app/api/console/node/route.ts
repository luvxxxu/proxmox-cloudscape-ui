import { type NextRequest } from "next/server";
import {
  getConsoleProxyEndpoint,
  parseConsoleMode,
  parseConsolePort,
} from "@/app/lib/console-session";
import { PVE_SESSION_COOKIE, parsePveSession } from "@/app/lib/pve-session";

const PROXMOX_HOST = process.env.PROXMOX_HOST ?? "";

export async function POST(request: NextRequest) {
  const { node, mode: requestedMode } = await request.json();
  const session = parsePveSession(request.cookies.get(PVE_SESSION_COOKIE)?.value);
  const mode = parseConsoleMode(requestedMode);

  if (!node || !mode) {
    return Response.json({ error: "Invalid console request" }, { status: 400 });
  }

  if (!PROXMOX_HOST) {
    return Response.json({ error: "PROXMOX_HOST not configured" }, { status: 500 });
  }

  if (!session) {
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }

  const headers: Record<string, string> = {
    Cookie: `PVEAuthCookie=${session.ticket}`,
    "Content-Type": "application/x-www-form-urlencoded",
    CSRFPreventionToken: session.csrfToken,
  };

  const proxyEndpoint = getConsoleProxyEndpoint("node", mode);
  const consoleRes = await fetch(
    `${PROXMOX_HOST}/api2/json/nodes/${encodeURIComponent(node)}/${proxyEndpoint}`,
    {
      method: "POST",
      headers,
      body: mode === "novnc" ? "websocket=1" : "",
    },
  );

  if (!consoleRes.ok) {
    const text = await consoleRes.text();
    return Response.json({ error: `${proxyEndpoint} failed: ${text}` }, { status: consoleRes.status });
  }

  const consoleJson = await consoleRes.json();
  const consoleData = consoleJson?.data;
  const port = parseConsolePort(consoleData?.port);
  if (
    typeof consoleData?.ticket !== "string"
    || port === null
  ) {
    return Response.json({ error: "Invalid Proxmox console response" }, { status: 502 });
  }

  return Response.json({
    ticket: consoleData.ticket,
    port,
    user: typeof consoleData.user === "string" ? consoleData.user : session.username,
    password: consoleData.password,
  });
}
