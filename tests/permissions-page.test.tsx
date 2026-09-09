import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { translations } from "@/app/lib/translations";
import createWrapper from "@cloudscape-design/components/test-utils/dom";
import PermissionsPage from "@/app/permissions/page";

vi.mock("@/app/lib/use-translation", () => ({ useTranslation: () => ({ language: "en", t: translate }) }));
function translate(key: string): string {
  let value: unknown = translations.en;
  for (const part of key.split(".")) value = value && typeof value === "object" ? (value as Record<string, unknown>)[part] : undefined;
  return typeof value === "string" ? value : key;
}

const fetchMock = vi.fn();
const users = [{ userid: "operator@pve", groups: "operators", email: "operator@example.com", tokens: [{ tokenid: "backup", privsep: 1 }], enable: 1 }];
const realms = [{ realm: "pve", type: "pve" }, { realm: "company", type: "ldap" }];
const replies: Record<string, unknown> = {
  "/api/proxmox/access/users?full=1": users,
  "/api/proxmox/access/groups": [{ groupid: "operators", users: "operator@pve" }],
  "/api/proxmox/access/roles": [{ roleid: "Administrator", privs: "VM.Audit VM.Console Sys.Audit", special: 1 }, { roleid: "Reader", privs: "VM.Audit" }],
  "/api/proxmox/access/acl": [],
  "/api/proxmox/access/domains": realms,
  "/api/proxmox/access/domains/company": { realm: "company", type: "ldap", server1: "ldap.example.com", base_dn: "dc=example,dc=com", user_attr: "uid", mode: "ldap+starttls", verify: 1, tfa: "type=oath,digits=8,step=60", digest: "digest-before" },
};

let consoleError: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  consoleError = vi.spyOn(console, "error");
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => new Response(JSON.stringify({ data: init?.method && init.method !== "GET" ? null : replies[url] ?? [] })));
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

function modal(): HTMLElement { return screen.getByRole("dialog"); }
function mutation(method: string) { return fetchMock.mock.calls.find((call) => call[1]?.method === method); }

describe("access management workflows", () => {
  it("preserves group membership when editing a profile and does not send a password to users PUT", async () => {
    render(<PermissionsPage />);
    await screen.findByText("operator@example.com");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const dialog = modal();
    fireEvent.change(within(dialog).getByLabelText("Email"), { target: { value: "new@example.com" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mutation("PUT")).toBeDefined());
    const [url, options] = mutation("PUT")!;
    expect(url).toBe("/api/proxmox/access/users/operator%40pve");
    const body = new URLSearchParams(options.body);
    expect(body.get("groups")).toBe("operators");
    expect(body.get("email")).toBe("new@example.com");
    expect(body.has("password")).toBe(false);
    expect(body.has("userid")).toBe(false);
  });

  it("creates an external-realm user without requiring an initial password", async () => {
    render(<PermissionsPage />);
    await screen.findByText("operator@example.com");
    fireEvent.click(screen.getByRole("button", { name: /Create user/i }));
    const dialog = modal();
    fireEvent.change(within(dialog).getByLabelText("User ID"), { target: { value: "alice@company" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create" }));
    await waitFor(() => expect(mutation("POST")).toBeDefined());
    const [url, options] = mutation("POST")!;
    expect(url).toBe("/api/proxmox/access/users");
    expect(new URLSearchParams(options.body).get("userid")).toBe("alice@company");
    expect(new URLSearchParams(options.body).has("password")).toBe(false);
  });

  it("creates a role using server-reported privilege choices", async () => {
    render(<PermissionsPage />);
    await screen.findByText("operator@example.com");
    fireEvent.click(screen.getByRole("tab", { name: "Roles" }));
    fireEvent.click(screen.getByRole("button", { name: /Create role/i }));
    const dialog = modal();
    fireEvent.change(within(dialog).getByLabelText("Role ID"), { target: { value: "GuestReader" } });
    const privileges = createWrapper(dialog).findMultiselect()!;
    privileges.openDropdown();
    privileges.selectOptionByValue("VM.Audit");
    fireEvent.click(within(dialog).getByRole("button", { name: "Create" }));
    await waitFor(() => expect(mutation("POST")).toBeDefined());
    const [url, options] = mutation("POST")!;
    expect(url).toBe("/api/proxmox/access/roles");
    const params = new URLSearchParams(options.body);
    expect(params.get("roleid")).toBe("GuestReader");
    expect(params.get("privs")).toBe("VM.Audit");
  });

  it("keeps usable user data when ACL listing is forbidden", async () => {
    fetchMock.mockImplementation(async (url: string) => url.endsWith("/acl") ? new Response('{"message":"Permission check failed"}', { status: 403 }) : new Response(JSON.stringify({ data: replies[url] ?? [] })));
    render(<PermissionsPage />);
    expect(await screen.findByText("operator@example.com")).toBeInTheDocument();
    expect(await screen.findByText(/ACL.*Permission check failed/)).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([url]) => /roles\//.test(url))).toHaveLength(0);
  });

  it("loads complete realm settings and retains security parameters while omitting an empty port", async () => {
    render(<PermissionsPage />);
    await screen.findByText("operator@example.com");
    fireEvent.click(screen.getByRole("tab", { name: "Realms" }));
    const companyRow = screen.getByText("company").closest("tr")!;
    fireEvent.click(within(companyRow).getByRole("button", { name: "Edit" }));
    await waitFor(() => expect(screen.getByDisplayValue("ldap.example.com")).toBeInTheDocument());
    fireEvent.click(within(modal()).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mutation("PUT")).toBeDefined());
    const [url, options] = mutation("PUT")!;
    expect(url).toBe("/api/proxmox/access/domains/company");
    const params = new URLSearchParams(options.body);
    expect(params.get("tfa")).toBe("type=oath,digits=8,step=60");
    expect(params.get("mode")).toBe("ldap+starttls");
    expect(params.get("verify")).toBe("1");
    expect(params.get("digest")).toBe("digest-before");
    expect(params.has("port")).toBe(false);
    expect(params.has("secure")).toBe(false);
  });
});
