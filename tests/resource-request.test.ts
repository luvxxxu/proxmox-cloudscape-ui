import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { requestResource, useResourceTaskRefresh } from "@/app/lib/resource-request";

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("@/app/lib/api-client", () => ({ apiFetch }));

beforeEach(() => apiFetch.mockReset());

describe("resource requests", () => {
  it("retains structured error information", async () => {
    apiFetch.mockResolvedValueOnce(new Response(JSON.stringify({ errors: { vmid: "already exists" } }), { status: 400 }));
    await expect(requestResource("/api/proxmox/nodes/pve/qemu", { method: "POST" })).rejects.toThrow("vmid: already exists");
  });
  it("rejects malformed successful responses rather than rendering an empty resource list", async () => {
    apiFetch.mockResolvedValueOnce(new Response("<html>proxy error</html>", { status: 200 }));
    await expect(requestResource("/api/proxmox/nodes")).rejects.toThrow("invalid response");
  });
  it("accepts a successful null result from an update", async () => {
    apiFetch.mockResolvedValueOnce(new Response('{"data":null}'));
    await expect(requestResource("/api/proxmox/pools/a", { method: "PUT" })).resolves.toBeNull();
  });
  it("announces a submitted task for the actual UPID node and preserves encoded form headers", async () => {
    const listener = vi.fn();
    window.addEventListener("proxmox-task-started", listener);
    const upid = "UPID:pve2:00001234:00005678:12345678:qmclone:100:root@pam:";
    apiFetch.mockResolvedValueOnce(new Response(JSON.stringify({ data: upid })));
    await requestResource("/api/proxmox/nodes/pve/qemu/100/clone", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "newid=200" });
    expect(listener).toHaveBeenCalledOnce();
    expect(listener.mock.calls[0][0].detail).toEqual({ upid, node: "pve2", description: "qmclone 100" });
    expect(apiFetch.mock.calls[0][1].headers.get("Content-Type")).toBe("application/x-www-form-urlencoded");
    window.removeEventListener("proxmox-task-started", listener);
  });
  it("refreshes on task completion and removes the listener after unmount", () => {
    const refresh = vi.fn();
    const { unmount } = renderHook(() => useResourceTaskRefresh(refresh));
    act(() => window.dispatchEvent(new CustomEvent("proxmox-task-finished")));
    expect(refresh).toHaveBeenCalledOnce();
    unmount();
    act(() => window.dispatchEvent(new CustomEvent("proxmox-task-finished")));
    expect(refresh).toHaveBeenCalledOnce();
  });
});
