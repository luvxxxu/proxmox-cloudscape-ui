import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import NodesPage from "@/app/nodes/page";

const requests = vi.hoisted(() => vi.fn());
vi.mock("@/app/lib/use-translation", () => ({ useTranslation: () => ({ t: translate }) }));
function translate(key: string) { return key; }
vi.mock("@/app/lib/resource-request", () => ({ requestResource: requests, useResourceTaskRefresh: () => {} }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
  requests.mockReset();
  requests.mockResolvedValue([]);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("uses pasted peer details and the joining node's own link address in cluster join", async () => {
  render(<NodesPage />);
  fireEvent.click(screen.getByRole("button", { name: "nodes.joinCluster" }));
  const dialog = screen.getByRole("dialog");
  const fingerprint = Array.from({ length: 32 }, () => "AB").join(":");
  const encoded = btoa(JSON.stringify({ ipAddress: "192.0.2.1", fingerprint, totem: { interface: { 0: { linknumber: 0 } } } }));
  fireEvent.change(within(dialog).getByLabelText("nodes.clusterJoinLink"), { target: { value: encoded } });
  expect(within(dialog).getByLabelText("nodes.peerHostname")).toHaveValue("192.0.2.1");
  expect(within(dialog).getByLabelText("nodes.joinFingerprint")).toHaveValue(fingerprint);
  fireEvent.change(within(dialog).getByLabelText("nodes.localClusterLink"), { target: { value: "192.0.2.2" } });
  fireEvent.change(within(dialog).getByLabelText("nodes.joinPassword"), { target: { value: " peer password " } });
  fireEvent.click(within(dialog).getByRole("button", { name: "common.save" }));
  await waitFor(() => expect(requests.mock.calls.some(([, init]) => init?.method === "POST")).toBe(true));
  const [url, init] = requests.mock.calls.find(([, options]) => options?.method === "POST")!;
  expect(url).toBe("/api/proxmox/cluster/config/join");
  expect(Object.fromEntries(new URLSearchParams(init.body))).toEqual({ hostname: "192.0.2.1", fingerprint, password: " peer password ", link0: "address=192.0.2.2" });
});
