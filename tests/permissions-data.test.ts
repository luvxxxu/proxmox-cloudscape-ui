import { describe, expect, it } from "vitest";
import { accessList, formatExpireInput, isValidAccessId, isValidTokenId, isValidUserId, makeTotpUri, parseExpireInput, realmTfaType } from "@/app/permissions/access-data";

describe("Proxmox access data", () => {
  it("normalizes comma and whitespace privilege lists without duplicates", () => {
    expect(accessList("VM.Audit VM.Console,VM.Audit\nSys.Audit")).toEqual(["VM.Audit", "VM.Console", "Sys.Audit"]);
    expect(accessList(["ops", " ops ", ""])).toEqual(["ops"]);
  });
  it("rejects normalized impossible calendar dates", () => {
    for (const value of ["2026-02-29", "2026-04-31", "2026-13-01", "2026-01-00", "2026-1-01", "1969-12-31"]) expect(parseExpireInput(value).valid).toBe(false);
    expect(parseExpireInput("2028-02-29").valid).toBe(true);
    expect(parseExpireInput("")).toEqual({ valid: true, epoch: "0" });
  });
  it("roundtrips expiry dates in the user's local timezone without UTC date drift", () => {
    for (const value of ["2026-01-01", "2026-07-01", "2028-02-29"]) expect(formatExpireInput(Number(parseExpireInput(value).epoch))).toBe(value);
    expect(formatExpireInput(NaN)).toBe("");
  });
  it("matches the API's user, role, group and token ID constraints", () => {
    expect(isValidUserId("operator@pve")).toBe(true);
    expect(isValidUserId("operator")).toBe(false);
    expect(isValidUserId("operator/test@pve")).toBe(false);
    expect(isValidUserId("a".repeat(65) + "@pve")).toBe(false);
    expect(isValidAccessId("Ops_Read-Only.1")).toBe(true);
    expect(isValidAccessId("Ops Team")).toBe(false);
    expect(isValidTokenId("backup-token")).toBe(true);
    expect(isValidTokenId("a")).toBe(false);
    expect(isValidTokenId("1-token")).toBe(false);
  });
  it("reads realm list and realm configuration TFA formats", () => {
    expect(realmTfaType("oath")).toBe("oath");
    expect(realmTfaType("type=oath,digits=8,step=60")).toBe("oath");
    expect(realmTfaType("type=yubico,id=1,key=secret")).toBe("yubico");
    expect(realmTfaType()).toBe("none");
  });
  it("encodes a TOTP secret using RFC 4648 base32", () => {
    const uri = new URL(makeTotpUri("operator@pve", new TextEncoder().encode("12345678901234567890")));
    expect(uri.protocol).toBe("otpauth:");
    expect(uri.searchParams.get("secret")).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    expect(uri.searchParams.get("period")).toBe("30");
    expect(decodeURIComponent(uri.pathname)).toBe("/Proxmox:operator@pve");
  });
});
