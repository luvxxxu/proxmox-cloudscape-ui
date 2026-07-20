export type ConsoleMode = "novnc" | "xterm";
export type ConsoleTarget = "node" | "qemu" | "lxc";

export interface ConsoleSession {
  mode: ConsoleMode;
  wsUrl: string;
  ticket: string;
  user: string;
  password?: string;
}

export function parseConsoleMode(value: unknown): ConsoleMode | null {
  return value === "novnc" || value === "xterm" ? value : null;
}

export function getConsoleProxyEndpoint(target: ConsoleTarget, mode: ConsoleMode): string {
  if (mode === "xterm") return "termproxy";
  return target === "node" ? "vncshell" : "vncproxy";
}

export function parseConsolePort(value: unknown): number | null {
  const port = typeof value === "number"
    ? value
    : typeof value === "string" && /^\d+$/.test(value)
      ? Number(value)
      : Number.NaN;

  return Number.isInteger(port) && port >= 5900 && port <= 5999 ? port : null;
}

export function hasQemuSerialInterface(config: Record<string, unknown>): boolean {
  return Object.entries(config).some(([key, value]) => (
    /^serial[0-3]$/.test(key)
    && typeof value === "string"
    && value !== ""
    && value !== "none"
  ));
}
