import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import createWrapper from "@cloudscape-design/components/test-utils/dom";
import LogsPage from "@/app/logs/page";

const requests = vi.hoisted(() => vi.fn());
vi.mock("@/app/lib/use-translation", () => ({ useTranslation: () => ({ t: translate }) }));
function translate(key: string) { return key; }
vi.mock("@/app/lib/resource-request", () => ({ requestResource: requests, useResourceTaskRefresh: () => {} }));

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
  requests.mockReset();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("system log and task views", () => {
  it("displays canonical syslog line text and preserves tasks from accessible nodes", async () => {
    requests.mockImplementation(async (url: string) => {
      if (url.endsWith("/nodes")) return [{ node: "pve1", status: "online" }, { node: "pve2", status: "online" }];
      if (url.includes("/pve2/tasks")) throw new Error("Permission check failed");
      if (url.includes("/pve1/tasks")) return [{ upid: "UPID:pve1:1:2:3:qmstart:100:root@pam:", type: "qmstart", id: "100", status: "OK" }];
      if (url.includes("/syslog")) return [{ n: 1, t: "Sep 09 12:00:00 pve1 pvedaemon: authenticated" }];
      throw new Error(`Unexpected request: ${url}`);
    });
    render(<LogsPage />);
    expect(await screen.findByText("qmstart")).toBeInTheDocument();
    expect(screen.getByText("pve2: Permission check failed")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "logs.systemLog" }));
    expect(await screen.findByText("Sep 09 12:00:00 pve1 pvedaemon: authenticated")).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "logs.timestamp" })).toBeNull();
  });

  it("does not replace the selected node's log with a late response from the previous node", async () => {
    let finishFirst: (data: unknown) => void = () => {};
    requests.mockImplementation(async (url: string) => {
      if (url.endsWith("/nodes")) return [{ node: "pve1", status: "online" }, { node: "pve2", status: "online" }];
      if (url.includes("/tasks")) return [];
      if (url.includes("/pve1/syslog")) return new Promise((resolve) => { finishFirst = resolve; });
      if (url.includes("/pve2/syslog")) return [{ n: 1, t: "pve2 current log" }];
      throw new Error(`Unexpected request: ${url}`);
    });
    const { container } = render(<LogsPage />);
    await waitFor(() => expect(requests.mock.calls.some(([url]) => url.includes("/pve1/syslog"))).toBe(true));
    fireEvent.click(screen.getByRole("tab", { name: "logs.systemLog" }));
    const selector = createWrapper(container).findSelect()!;
    act(() => selector.openDropdown());
    act(() => selector.selectOptionByValue("pve2"));
    expect(await screen.findByText("pve2 current log")).toBeInTheDocument();
    await act(async () => { finishFirst([{ n: 1, t: "pve1 stale log" }]); });
    expect(screen.queryByText("pve1 stale log")).toBeNull();
    expect(screen.getByText("pve2 current log")).toBeInTheDocument();
  });
});
