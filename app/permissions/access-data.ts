/** Proxmox list values may use commas or whitespace (privilege lists use both). */
export function accessList(value?: string[] | string): string[] {
  return [...new Set((Array.isArray(value) ? value : (value ?? "").split(/[,\s]+/)).map((item) => item.trim()).filter(Boolean))];
}

export function parseExpireInput(value: string): { valid: boolean; epoch: string } {
  if (!value.trim()) return { valid: true, epoch: "0" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return { valid: false, epoch: "0" };
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  if (year < 1970 || date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return { valid: false, epoch: "0" };
  }
  return { valid: true, epoch: String(Math.floor(date.getTime() / 1000)) };
}

export function formatExpireInput(expire?: number): string {
  if (!expire) return "";
  const date = new Date(expire * 1000);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function isValidUserId(value: string): boolean {
  return value.length <= 64 && /^[^\s:/]+@[A-Za-z][A-Za-z0-9._-]+$/.test(value);
}

export function isValidAccessId(value: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(value);
}

export function isValidTokenId(value: string): boolean {
  return /^[A-Za-z][A-Za-z0-9._-]+$/.test(value);
}

export function realmTfaType(value?: string): "none" | "oath" | "yubico" {
  const type = value?.split(",").find((part) => part.startsWith("type="))?.slice(5) ?? value;
  return type === "oath" || type === "yubico" ? type : "none";
}

export function makeTotpUri(userid: string, randomBytes: Uint8Array): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  let secret = "";
  for (const byte of randomBytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      secret += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) secret += alphabet[(value << (5 - bits)) & 31];
  return `otpauth://totp/${encodeURIComponent(`Proxmox:${userid}`)}?secret=${secret}&issuer=Proxmox&algorithm=SHA1&digits=6&period=30`;
}
