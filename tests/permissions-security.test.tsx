import createWrapper from "@cloudscape-design/components/test-utils/dom";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import UserSecurity from "@/app/permissions/user-security";
import { translations } from "@/app/lib/translations";

vi.mock("@/app/lib/use-translation", () => ({ useTranslation: () => ({ language: "en", t: translate }) }));
function translate(key: string): string {
  let value: unknown = translations.en;
  for (const part of key.split(".")) value = value && typeof value === "object" ? (value as Record<string, unknown>)[part] : undefined;
  return typeof value === "string" ? value : key;
}
const { registerMock } = vi.hoisted(() => ({ registerMock: vi.fn() }));
vi.mock("@/app/lib/webauthn-client", () => ({ registerWebAuthn: registerMock }));
const fetchMock = vi.fn();
const changed = vi.fn(async () => {});
const dismissed = vi.fn();
function mutation(method: string) { return fetchMock.mock.calls.find((call) => call[1]?.method === method); }

let consoleError: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  consoleError = vi.spyOn(console, "error");
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
  fetchMock.mockReset(); changed.mockClear(); dismissed.mockClear(); registerMock.mockReset();
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const data = init?.method === "POST" && url.includes("/token/") ? { "full-tokenid": "operator@pve!backup-token", value: "one-time-secret" }
      : init?.method ? null : url.endsWith("/token") ? [{ tokenid: "existing-token", privsep: 1 }] : [];
    return new Response(JSON.stringify({ data }));
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  try {
    // Empty string conditional children create unkeyed Cloudscape spacing wrappers.
    expect(consoleError.mock.calls.filter(([message]: unknown[]) => String(message).includes('unique "key"'))).toEqual([]);
  } finally {
    consoleError.mockRestore();
  }
});

describe("user security workflows", () => {
  it("creates a restricted token and displays its secret only until acknowledged", async () => {
    render(<UserSecurity userid="operator@pve" onChanged={changed} onDismiss={dismissed} />);
    await screen.findByText("existing-token");
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    fireEvent.change(screen.getByLabelText("Token ID"), { target: { value: "backup-token" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Create" }).at(-1)!);
    expect(await screen.findByText("one-time-secret")).toBeInTheDocument();
    const [url, options] = mutation("POST")!;
    expect(url).toBe("/api/proxmox/access/users/operator%40pve/token/backup-token");
    const params = new URLSearchParams(options.body);
    expect(params.get("privsep")).toBe("1");
    expect(params.has("expire")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "I saved the secret" }));
    expect(screen.queryByText("one-time-secret")).not.toBeInTheDocument();
  });

  it("clears token-specific expiration using expire=0 rather than unsupported delete=expire", async () => {
    render(<UserSecurity userid="operator@pve" onChanged={changed} onDismiss={dismissed} />);
    await screen.findByText("existing-token");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(mutation("PUT")).toBeDefined());
    const params = new URLSearchParams(mutation("PUT")![1].body);
    expect(params.get("expire")).toBe("0");
    expect(params.has("delete")).toBe(false);
  });

  it("uses the password endpoint with operator confirmation and clears secrets after success", async () => {
    render(<UserSecurity userid="operator@pve" onChanged={changed} onDismiss={dismissed} />);
    await screen.findByText("existing-token");
    fireEvent.click(screen.getByRole("tab", { name: "Password" }));
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "new-password" } });
    fireEvent.change(screen.getByLabelText("Repeat password"), { target: { value: "new-password" } });
    fireEvent.change(screen.getByLabelText("Operator password — optional"), { target: { value: "admin-secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Change password" }));
    await waitFor(() => expect(mutation("PUT")).toBeDefined());
    const [url, options] = mutation("PUT")!;
    expect(url).toBe("/api/proxmox/access/password");
    const params = new URLSearchParams(options.body);
    expect(params.get("password")).toBe("new-password");
    expect(params.get("confirmation-password")).toBe("admin-secret");
    await waitFor(() => expect(screen.getByLabelText("New password")).toHaveValue(""));
    expect(screen.getByLabelText("Operator password — optional")).toHaveValue("");
  });

  it("requires explicit confirmation before deleting a token", async () => {
    render(<UserSecurity userid="operator@pve" onChanged={changed} onDismiss={dismissed} />);
    await screen.findByText("existing-token");
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(mutation("DELETE")).toBeUndefined();
    const warning = screen.getByText(/Applications using this token will lose access/);
    expect(warning).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Delete" }).at(-1)!);
    await waitFor(() => expect(mutation("DELETE")).toBeDefined());
    expect(mutation("DELETE")![0]).toBe("/api/proxmox/access/users/operator%40pve/token/existing-token");
  });

  it("shows non-propagating privileges as effective permissions", async () => {
    fetchMock.mockImplementation(async (url: string) => new Response(JSON.stringify({ data: url.includes("/permissions?") ? { "/vms/100": { "VM.Audit": 0 } } : [{ tokenid: "existing-token" }] })));
    render(<UserSecurity userid="operator@pve" onChanged={changed} onDismiss={dismissed} />);
    await screen.findByText("existing-token");
    fireEvent.click(screen.getByRole("tab", { name: "Effective permissions" }));
    const row = (await screen.findByText("VM.Audit")).closest("tr")!;
    expect(within(row).getByText("/vms/100")).toBeInTheDocument();
    expect(within(row).getByText("No")).toBeInTheDocument();
  });

  async function openWebauthnForm() {
    render(<UserSecurity userid="operator@pve" onChanged={changed} onDismiss={dismissed} />);
    await screen.findByText("existing-token");
    fireEvent.click(screen.getByRole("tab", { name: "Two-factor authentication" }));
    await screen.findByText("No authentication factors.");
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    const select = createWrapper().findSelect()!;
    act(() => select.openDropdown());
    act(() => select.selectOptionByValue("webauthn"));
    fireEvent.change(screen.getByLabelText("Comment"), { target: { value: "Laptop passkey" } });
    fireEvent.change(screen.getByLabelText("Operator password — optional"), { target: { value: "operator-secret" } });
  }
  function mockWebauthnApi() {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      const params = new URLSearchParams(String(init?.body || ""));
      const data = init?.method === "POST" ? params.has("challenge") ? { id: "new-factor" } : { challenge: "serialized-registration-challenge" }
        : url.endsWith("/token") ? [{ tokenid: "existing-token" }] : [];
      return Response.json({ data });
    });
  }
  it("registers a WebAuthn factor through the official challenge and attestation exchange", async () => {
    mockWebauthnApi();
    registerMock.mockResolvedValue({ challenge: "original-challenge", value: '{"id":"credential"}' });
    await openWebauthnForm();
    fireEvent.click(screen.getAllByRole("button", { name: "Create" }).at(-1)!);
    await screen.findByText("Changes saved.");
    const requests = fetchMock.mock.calls.filter(call => call[1]?.method === "POST");
    expect(requests).toHaveLength(2);
    expect(requests[0][0]).toBe("/api/proxmox/access/tfa/operator%40pve");
    expect(new URLSearchParams(requests[0][1].body)).toEqual(new URLSearchParams({ password: "operator-secret", type: "webauthn", description: "Laptop passkey" }));
    expect(new URLSearchParams(requests[1][1].body)).toEqual(new URLSearchParams({ type: "webauthn", challenge: "original-challenge", value: '{"id":"credential"}', password: "operator-secret" }));
    expect(registerMock).toHaveBeenCalledWith("serialized-registration-challenge", expect.any(AbortSignal));
    expect(screen.queryByLabelText("Operator password — optional")).not.toBeInTheDocument();
  });
  it("cancels a pending browser registration without submitting attestation or retaining the password", async () => {
    mockWebauthnApi();
    registerMock.mockImplementation((_challenge, signal: AbortSignal) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true })));
    await openWebauthnForm();
    fireEvent.click(screen.getAllByRole("button", { name: "Create" }).at(-1)!);
    await waitFor(() => expect(registerMock).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Create" })).not.toBeDisabled());
    expect(fetchMock.mock.calls.filter(call => call[1]?.method === "POST")).toHaveLength(1);
    expect(screen.queryByLabelText("Operator password — optional")).not.toBeInTheDocument();
    expect(screen.queryByText("Changes saved.")).not.toBeInTheDocument();
  });

});
