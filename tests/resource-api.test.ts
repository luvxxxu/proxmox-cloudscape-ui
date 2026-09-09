import { describe, expect, it } from "vitest";
import {
  buildReplicationParameters, buildRestoreParameters, createStorageUploadForm,
  formatNetworkCidr, formatResourceBytes, inferBackupGuestType, isStorageActive,
  isValidVmid, parseNetworkIpv4, poolMemberVmid, resourceErrorMessage, setOptionalParameters, syslogMessage,
  parseClusterJoinInfo, buildClusterJoinParameters,
  collectResourceResults,
} from "@/app/lib/resource-api";

const replication = { guest: "100", target: "pve2", schedule: "*/15", rate: "", comment: "", type: "local" };

describe("Proxmox resource requests", () => {
  it("uses the required replication job ID and skips used slots", () => {
    const params = buildReplicationParameters(replication, "create", ["100-0", "100-2", "200-1"]);
    expect(Object.fromEntries(params)).toEqual({ id: "100-1", target: "pve2", type: "local", schedule: "*/15" });
  });
  it("does not send immutable replication fields on update, and clears removed options", () => {
    const params = buildReplicationParameters(replication, "edit", []);
    expect(Object.fromEntries(params)).toEqual({ schedule: "*/15", delete: "rate,comment" });
  });
  it.each(["abc", "-1", "0", "Infinity"])("rejects invalid replication rate %s", (rate) => {
    expect(() => buildReplicationParameters({ ...replication, rate }, "create", [])).toThrow();
  });
  it("restores LXC using ostemplate and restore rather than the QEMU archive field", () => {
    const volid = "pbs:backup/ct/100/2026-09-09T00:00:00Z";
    expect(Object.fromEntries(buildRestoreParameters("lxc", "201", volid, "local-lvm"))).toEqual({
      vmid: "201", storage: "local-lvm", ostemplate: volid, restore: "1",
    });
  });
  it("restores QEMU without permitting overwrite of an existing guest", () => {
    const params = buildRestoreParameters("qemu", "202", "local:backup/vzdump-qemu-100.vma.zst", "local-lvm");
    expect(params.get("archive")).toContain("vzdump-qemu");
    expect(params.has("ostemplate")).toBe(false);
    expect(params.has("force")).toBe(false);
  });
  it.each(["0", "99", "1000000000", "1.5", "100x", "0100", "1e3"])("rejects invalid guest ID %s", (value) => {
    expect(isValidVmid(value)).toBe(false);
    expect(() => buildRestoreParameters("qemu", value, "a", "b")).toThrow();
  });
  it("accepts Proxmox guest ID boundaries", () => {
    expect(isValidVmid("100")).toBe(true);
    expect(isValidVmid("999999999")).toBe(true);
  });
  it.each([
    ["local:backup/vzdump-qemu-100-2026_09_09-00_00_00.vma.zst", "qemu"],
    ["local:backup/vzdump-lxc-100-2026_09_09-00_00_00.tar.zst", "lxc"],
    ["pbs:backup/vm/100/2026-09-09T00:00:00Z", "qemu"],
    ["pbs:backup/ct/100/2026-09-09T00:00:00Z", "lxc"],
    ["other:unknown", "unknown"],
  ])("recognizes backup type from %s", (volid, expected) => {
    expect(inferBackupGuestType(volid)).toBe(expected);
  });
  it("uses the numeric ID when removing pool members", () => {
    expect(poolMemberVmid({ id: "qemu/100", vmid: 100 })).toBe("100");
    expect(poolMemberVmid({ id: "lxc/201" })).toBe("201");
    expect(() => poolMemberVmid({ id: "storage/pve/local" })).toThrow();
  });
  it("puts upload bytes in the filename multipart field required by Proxmox", () => {
    const file = new File(["iso bytes"], "debian.iso", { type: "application/octet-stream" });
    const form = createStorageUploadForm(file, "iso");
    expect(form.get("filename")).toBeInstanceOf(File);
    expect((form.get("filename") as File).name).toBe("debian.iso");
    expect(form.get("content")).toBe("iso");
    expect(form.has("file")).toBe(false);
  });
  it("clears removed firewall constraints using delete without overwriting retained fields", () => {
    const params = new URLSearchParams({ delete: "macro" });
    setOptionalParameters(params, { source: "", proto: " tcp ", dport: "443" }, true);
    expect(Object.fromEntries(params)).toEqual({ delete: "macro,source", proto: "tcp", dport: "443" });
  });
  it("removes a stale delete list when every cleared field is restored", () => {
    const params = new URLSearchParams({ delete: "source" });
    setOptionalParameters(params, { source: "192.0.2.0/24" }, true);
    expect(Object.fromEntries(params)).toEqual({ source: "192.0.2.0/24" });
  });
  it("renders canonical syslog line text instead of mistaking t for a timestamp", () => {
    expect(syslogMessage({ t: "Sep 09 12:00:00 pve pvedaemon[123]: user authenticated" })).toContain("user authenticated");
    expect(syslogMessage({ t: "", msg: "structured message" })).toBe("structured message");
  });
  it("rejects explicitly inactive storage even when the status field is absent", () => {
    expect(isStorageActive({ active: 0 })).toBe(false);
    expect(isStorageActive({ active: 0, status: "active" })).toBe(false);
    expect(isStorageActive({ active: 1, enabled: 0 })).toBe(false);
    expect(isStorageActive({ active: 1 })).toBe(true);
  });
  it("preserves field-specific Proxmox validation errors", () => {
    expect(resourceErrorMessage({ message: "Parameter verification failed.", errors: { vmid: "already exists" } }, "500"))
      .toBe("Parameter verification failed. — vmid: already exists");
    expect(resourceErrorMessage({ error: "Session expired" }, "401")).toBe("Session expired");
  });
  it("retains readable resources and identifies the failed node in a partial cluster response", async () => {
    const results = await Promise.allSettled([Promise.resolve([{ storage: "local" }]), Promise.reject(new Error("Permission check failed"))]);
    expect(collectResourceResults(results, ["pve1", "pve2"])).toEqual({ values: [{ storage: "local" }], errors: ["pve2: Permission check failed"] });
  });
});

describe("cluster join information", () => {
  const fingerprint = Array.from({ length: 32 }, () => "AB").join(":");
  const encoded = (value: unknown) => btoa(JSON.stringify(value));
  it("decodes the peer details and keeps the joining node's link addresses separate", () => {
    const info = parseClusterJoinInfo(encoded({ ipAddress: "192.0.2.1", fingerprint, totem: { interface: { 0: { linknumber: 0 }, 1: { linknumber: 1 } } } }))!;
    expect(info).toMatchObject({ hostname: "192.0.2.1", links: [0, 1], requiredLinks: [0, 1] });
    const form = { hostname: info.hostname, fingerprint, password: " secret with spaces ", links: { 0: "192.0.2.2", 1: "198.51.100.2" } };
    expect(Object.fromEntries(buildClusterJoinParameters(form, info))).toEqual({ hostname: "192.0.2.1", fingerprint, password: " secret with spaces ", link0: "address=192.0.2.2", link1: "address=198.51.100.2" });
    expect(() => buildClusterJoinParameters({ ...form, links: { 0: "192.0.2.2" } }, info)).toThrow("link 1");
  });
  it("allows automatic local hostname resolution only for the compatible single-link layout", () => {
    const info = parseClusterJoinInfo(encoded({ ipAddress: "192.0.2.1", fingerprint, ring_addr: ["192.0.2.1"], totem: { interface: { 0: { linknumber: 0 } } } }))!;
    const params = buildClusterJoinParameters({ hostname: info.hostname, fingerprint, password: "secret", links: {} }, info);
    expect(params.has("link0")).toBe(false);
  });
  it("rejects malformed serialized input and certificate fingerprints", () => {
    expect(() => parseClusterJoinInfo("not-join-info")).toThrow();
    expect(() => parseClusterJoinInfo(encoded({ hostname: "wrong-shape" }))).toThrow();
    expect(() => buildClusterJoinParameters({ hostname: "192.0.2.1", fingerprint: "AB:CD", password: "secret", links: {} }, null)).toThrow("fingerprint");
  });
});

describe("network configuration integrity", () => {
  it("does not duplicate complete CIDR addresses when opening an existing interface", () => {
    expect(formatNetworkCidr({ address: "192.0.2.10", cidr: "192.0.2.10/24", netmask: "255.255.255.0" })).toBe("192.0.2.10/24");
  });
  it("converts the entire valid prefix, including zero, to a netmask", () => {
    expect(parseNetworkIpv4("192.0.2.10/0")).toEqual({ address: "192.0.2.10", netmask: "0.0.0.0" });
    expect(parseNetworkIpv4("192.0.2.10/32")).toEqual({ address: "192.0.2.10", netmask: "255.255.255.255" });
    expect(parseNetworkIpv4("192.0.2.10/255.255.255.0")).toEqual({ address: "192.0.2.10", netmask: "255.255.255.0" });
  });
  it.each(["192.0.2.10/24oops", "192.0.2.10/24/1", "192.0.2.256/24", "192.0.2.10/255.0.255.0", "192.0.2.10/33"])("rejects invalid network configuration %s", (value) => {
    expect(() => parseNetworkIpv4(value)).toThrow();
  });
});

describe("resource sizes", () => {
  it("distinguishes unavailable/invalid measurements from zero and uses IEC units", () => {
    expect(formatResourceBytes()).toBe("-");
    expect(formatResourceBytes(-1)).toBe("-");
    expect(formatResourceBytes(Infinity)).toBe("-");
    expect(formatResourceBytes(0)).toBe("0 B");
    expect(formatResourceBytes(1024)).toBe("1.0 KiB");
    expect(formatResourceBytes(0.5)).toBe("0.5 B");
    expect(formatResourceBytes(1024 ** 5)).toBe("1.0 PiB");
  });
});

describe("compound VM settings", () => {
  it("reads both compact and keyed guest agent flags", async () => {
    const { readPropertyValue } = await import("@/app/lib/resource-api");
    expect(readPropertyValue("1,type=isa,freeze-fs=0", "enabled")).toBe("1");
    expect(readPropertyValue("enabled=1,type=virtio", "enabled")).toBe("1");
    expect(readPropertyValue("current=4096", "current")).toBe("4096");
    expect(readPropertyValue(2048, "current")).toBe("2048");
  });
  it("does not erase guest agent options while toggling its enabled flag", async () => {
    const { updatePropertyValue } = await import("@/app/lib/resource-api");
    expect(updatePropertyValue("1,type=isa,freeze-fs=0", "enabled", "0")).toBe("enabled=0,type=isa,freeze-fs=0");
  });
  it("rejects NaN, infinity, fractional and zero CPU resources before API submission", async () => {
    const { isIntegerInRange } = await import("@/app/lib/resource-api");
    for (const value of ["NaN", "Infinity", "1.5", "0", "-1", "1foo"]) expect(isIntegerInRange(value, 1)).toBe(false);
    expect(isIntegerInRange("0", 0)).toBe(true);
    expect(isIntegerInRange("8192", 16, 4096)).toBe(false);
  });
});
