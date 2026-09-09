import { beforeEach, describe, expect, it, vi } from "vitest";
import { accessErrorMessage, accessRequest, formRequest } from "@/app/permissions/access-api";

const fetchMock = vi.fn();
beforeEach(() => { vi.stubGlobal("fetch", fetchMock); fetchMock.mockReset(); });

describe("access management API", () => {
  it("displays Proxmox parameter errors instead of losing the reason", () => {
    expect(accessErrorMessage({ message: "Parameter verification failed.", errors: { port: "type check ('integer') failed" } }, "Failed")).toEqual({ message: "Parameter verification failed.: port: type check ('integer') failed", fields: { port: "type check ('integer') failed" } });
  });
  it("does not replay token creation after an upstream failure", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ message: "Service unavailable" }), { status: 503 }));
    await expect(accessRequest("/api/proxmox/access/users/operator%40pve/token/backup", formRequest("POST", new URLSearchParams({ privsep: "1" })))).rejects.toThrow("Service unavailable");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("accepts the Proxmox null mutation envelope", async () => {
    fetchMock.mockResolvedValue(new Response('{"data":null}'));
    expect(await accessRequest("/api/proxmox/access/users", formRequest("POST", new URLSearchParams()))).toBeNull();
  });
  it("rejects a malformed successful response", async () => {
    fetchMock.mockResolvedValue(new Response("<html>Login</html>"));
    await expect(accessRequest("/api/proxmox/access/users")).rejects.toThrow("Invalid Proxmox API response");
  });
  it("keeps password and token values in the body without corrupting special characters", () => {
    const body = formRequest("PUT", new URLSearchParams({ password: "a+b&c=d %" }));
    expect(new URLSearchParams(body.body as string).get("password")).toBe("a+b&c=d %");
  });
});
