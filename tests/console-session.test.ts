import { describe, expect, it } from "vitest";
import {
  getConsoleProxyEndpoint,
  hasQemuSerialInterface,
  parseConsoleMode,
  parseConsolePort,
} from "@/app/lib/console-session";

describe("console session selection", () => {
  it("selects the graphical proxy endpoints for noVNC", () => {
    expect(getConsoleProxyEndpoint("node", "novnc")).toBe("vncshell");
    expect(getConsoleProxyEndpoint("qemu", "novnc")).toBe("vncproxy");
    expect(getConsoleProxyEndpoint("lxc", "novnc")).toBe("vncproxy");
  });

  it("selects termproxy for every xterm target", () => {
    expect(getConsoleProxyEndpoint("node", "xterm")).toBe("termproxy");
    expect(getConsoleProxyEndpoint("qemu", "xterm")).toBe("termproxy");
    expect(getConsoleProxyEndpoint("lxc", "xterm")).toBe("termproxy");
  });

  it("rejects unknown viewer modes", () => {
    expect(parseConsoleMode("novnc")).toBe("novnc");
    expect(parseConsoleMode("xterm")).toBe("xterm");
    expect(parseConsoleMode("spice")).toBeNull();
    expect(parseConsoleMode(undefined)).toBeNull();
  });

  it("normalizes numeric and string Proxmox console ports", () => {
    expect(parseConsolePort(5900)).toBe(5900);
    expect(parseConsolePort("5901")).toBe(5901);
    expect(parseConsolePort("not-a-port")).toBeNull();
    expect(parseConsolePort(6000)).toBeNull();
  });

  it("detects configured QEMU serial interfaces", () => {
    expect(hasQemuSerialInterface({ serial0: "socket" })).toBe(true);
    expect(hasQemuSerialInterface({ serial3: "/dev/ttyS0" })).toBe(true);
    expect(hasQemuSerialInterface({ serial0: "none" })).toBe(false);
    expect(hasQemuSerialInterface({ vga: "std" })).toBe(false);
  });
});
