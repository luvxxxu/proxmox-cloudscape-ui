import { Suspense } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { translations } from "@/app/lib/translations";
import NodeDetailPage from "@/app/nodes/[node]/page";
import ContainerDetailPage from "@/app/containers/[ctid]/page";
import VirtualMachineDetailPage from "@/app/vms/[vmid]/page";

let routeNode = "alpha";
const requestMock = vi.fn();
vi.mock("next/navigation", () => ({ useParams: () => ({ node: routeNode }), useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/app/components/settings-context", () => ({ useSettings: () => ({ confirmPowerActions: true }) }));
vi.mock("@/app/lib/use-translation", () => ({ useTranslation: () => ({ language: "en", t: translate }) }));
vi.mock("@cloudscape-design/components/area-chart", () => ({ default: () => <div>Performance chart</div> }));
vi.mock("@/app/lib/resource-request", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/app/lib/resource-request")>(),
  requestResource: (...args: unknown[]) => requestMock(...args),
}));
function translate(key: string): string {
  let value: unknown = translations.en;
  for (const part of key.split(".")) value = value && typeof value === "object" ? (value as Record<string, unknown>)[part] : undefined;
  return typeof value === "string" ? value : key;
}
function response(path: string): unknown {
  if (path.endsWith("/status")) return { status: "online", kversion: path.includes("alpha") ? "kernel-alpha" : "kernel-beta", memory: { total: 1024, used: 512 } };
  if (path.endsWith("/dns")) return { search: path.includes("alpha") ? "alpha.example.com" : "beta.example.com" };
  if (path.endsWith("/firewall/options")) return { enable: 1 };
  if (path.endsWith("/disks/list")) return [{ devpath: "/dev/sdz", type: "hdd", size: 1024 }];
  return [];
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
beforeEach(() => {
  routeNode = "alpha";
  requestMock.mockReset().mockImplementation(async (path: string) => response(path));
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("resource detail identity and request lifecycle", () => {
  it("clears node tab data and open editors when navigating to another node", async () => {
    const view = render(<NodeDetailPage />);
    await screen.findByRole("tab", { name: "DNS" });
    fireEvent.click(screen.getByRole("tab", { name: "DNS" }));
    await screen.findByText("alpha.example.com");
    fireEvent.click(screen.getByRole("button", { name: "Edit DNS" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    routeNode = "beta";
    view.rerender(<NodeDetailPage />);
    await screen.findByRole("tab", { name: "DNS" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText("alpha.example.com")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "DNS" }));
    await screen.findByText("beta.example.com");
    expect(requestMock.mock.calls.filter(([path]) => path === "/api/proxmox/nodes/beta/dns")).toHaveLength(1);
  });

  it("aborts a superseded summary request and ignores a late stale response", async () => {
    const old = deferred<unknown>();
    let reads = 0;
    requestMock.mockImplementation(async (path: string) => path.endsWith("/status") && ++reads === 1 ? old.promise : response(path));
    render(<NodeDetailPage />);
    await waitFor(() => expect(requestMock).toHaveBeenCalled());
    const firstSignal = requestMock.mock.calls[0][1].signal as AbortSignal;
    act(() => window.dispatchEvent(new CustomEvent("proxmox-task-finished")));
    await screen.findByRole("tab", { name: "DNS" });
    fireEvent.click(screen.getByRole("tab", { name: "System" }));
    await screen.findByText("kernel-alpha");
    expect(firstSignal.aborted).toBe(true);
    await act(async () => old.resolve({ kversion: "kernel-stale" }));
    expect(screen.queryByText("kernel-stale")).not.toBeInTheDocument();
    expect(screen.getByText("kernel-alpha")).toBeInTheDocument();
  });

  it("starts firewall options only once while other firewall responses rerender", async () => {
    const options = deferred<unknown>();
    requestMock.mockImplementation(async (path: string) => path.endsWith("/firewall/options") ? options.promise : response(path));
    render(<NodeDetailPage />);
    await screen.findByRole("tab", { name: "DNS" });
    fireEvent.click(screen.getByRole("tab", { name: "Firewall" }));
    await waitFor(() => expect(requestMock.mock.calls.some(([path]) => path.endsWith("/firewall/log?limit=50"))).toBe(true));
    expect(requestMock.mock.calls.filter(([path]) => path.endsWith("/firewall/options"))).toHaveLength(1);
    await act(async () => options.resolve({ enable: 1 }));
    expect(requestMock.mock.calls.filter(([path]) => path.endsWith("/firewall/options"))).toHaveLength(1);
  });

  it("retains a firewall permission error when sibling requests succeed without retrying it", async () => {
    requestMock.mockImplementation(async (path: string) => {
      if (path.endsWith("/firewall/rules")) throw new Error("Rules access denied");
      return response(path);
    });
    render(<NodeDetailPage />);
    await screen.findByRole("tab", { name: "DNS" });
    fireEvent.click(screen.getByRole("tab", { name: "Firewall" }));
    await screen.findByText("Rules access denied");
    await waitFor(() => expect(requestMock.mock.calls.some(([path]) => path.endsWith("/firewall/log?limit=50"))).toBe(true));
    expect(screen.getByText("Rules access denied")).toBeInTheDocument();
    expect(requestMock.mock.calls.filter(([path]) => path.endsWith("/firewall/rules"))).toHaveLength(1);
  });

  it("requires the disk path and keeps a failed wipe visible in its confirmation", async () => {
    const wipe = deferred<unknown>();
    requestMock.mockImplementation(async (path: string, init?: RequestInit) => init?.method === "PUT" ? wipe.promise : response(path));
    render(<NodeDetailPage />);
    await screen.findByRole("tab", { name: "DNS" });
    fireEvent.click(screen.getByRole("tab", { name: "Disks" }));
    fireEvent.click(await screen.findByRole("button", { name: "Wipe disk" }));
    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByRole("button", { name: "Confirm" })).toBeDisabled();
    fireEvent.change(dialog.getByLabelText("Confirm disk path"), { target: { value: "/dev/sdz" } });
    fireEvent.click(dialog.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(requestMock.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(true));
    expect(dialog.getByRole("button", { name: "Cancel" })).toBeDisabled();
    await act(async () => wipe.reject(new Error("Disk is in use")));
    expect(within(screen.getByRole("dialog")).getByText("Disk is in use")).toBeInTheDocument();
    const mutation = requestMock.mock.calls.find(([, init]) => init?.method === "PUT")!;
    expect(new URLSearchParams(mutation[1].body).get("disk")).toBe("/dev/sdz");
  });

  it("never treats a QEMU resource as a container", async () => {
    requestMock.mockResolvedValue([{ vmid: 100, type: "qemu", node: "alpha", status: "stopped" }]);
    const params = Promise.resolve({ ctid: "100" });
    await act(async () => { render(<Suspense fallback="Loading"><ContainerDetailPage params={params} /></Suspense>); });
    await screen.findByText("Container 100 was not found");
    expect(requestMock.mock.calls.filter(([path]) => path.includes("/lxc/"))).toHaveLength(0);
  });

  it("rejects a nondecimal VM route before requesting an unintended guest", async () => {
    const params = Promise.resolve({ vmid: "1e2" });
    await act(async () => { render(<Suspense fallback="Loading"><VirtualMachineDetailPage params={params} /></Suspense>); });
    await screen.findByText(translate("vms.invalidVmid"));
    expect(requestMock).not.toHaveBeenCalled();
  });
});
