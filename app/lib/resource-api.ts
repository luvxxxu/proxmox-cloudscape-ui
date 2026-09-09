/** Proxmox scalar constraints and payloads shared by the resource forms. */
export function isValidVmid(value: string): boolean {
  return /^[1-9]\d{2,8}$/.test(value.trim());
}

export function isStorageActive(storage: { active?: number; enabled?: number; status?: string }): boolean {
  if (storage.active !== undefined) return storage.active === 1 && storage.enabled !== 0;
  if (storage.enabled === 0) return false;
  return storage.status === undefined || storage.status === "active";
}

export type BackupGuestType = "qemu" | "lxc" | "unknown";

export function inferBackupGuestType(volid: string): BackupGuestType {
  if (/vzdump-qemu-\d+-/.test(volid) || /:backup\/vm\/\d+\//.test(volid)) return "qemu";
  if (/vzdump-lxc-\d+-/.test(volid) || /:backup\/ct\/\d+\//.test(volid)) return "lxc";
  return "unknown";
}

export function buildRestoreParameters(guestType: BackupGuestType, vmid: string, volid: string, storage: string): URLSearchParams {
  if (!isValidVmid(vmid)) throw new Error("Guest ID must be an integer from 100 to 999999999.");
  if (guestType === "unknown") throw new Error("The backup guest type could not be determined.");
  const params = new URLSearchParams({ vmid: vmid.trim(), storage });
  if (guestType === "lxc") {
    params.set("ostemplate", volid);
    params.set("restore", "1");
  } else {
    params.set("archive", volid);
  }
  return params;
}

export interface ReplicationInput {
  guest: string;
  target: string;
  schedule: string;
  rate: string;
  comment: string;
  type: string;
}

export function buildReplicationParameters(form: ReplicationInput, mode: "create" | "edit", existingIds: readonly string[]): URLSearchParams {
  const guest = form.guest.trim();
  if (!isValidVmid(guest)) throw new Error("Guest ID must be an integer from 100 to 999999999.");
  if (!form.target.trim()) throw new Error("A target node is required.");
  const params = new URLSearchParams({ schedule: form.schedule.trim() || "*/15" });
  if (mode === "create") {
    const usedIds = new Set(existingIds);
    let jobNumber = 0;
    while (usedIds.has(`${guest}-${jobNumber}`)) jobNumber++;
    params.set("id", `${guest}-${jobNumber}`);
    params.set("target", form.target.trim());
    params.set("type", form.type || "local");
  }
  const rate = form.rate.trim();
  if (rate && (!Number.isFinite(Number(rate)) || Number(rate) <= 0)) {
    throw new Error("The replication rate must be a positive number in MiB/s, or blank for unlimited.");
  }
  const deleted: string[] = [];
  for (const [key, value] of [["rate", rate], ["comment", form.comment.trim()]]) {
    if (value) params.set(key, value);
    else if (mode === "edit") deleted.push(key);
  }
  if (deleted.length) params.set("delete", deleted.join(","));
  return params;
}

export function formatResourceBytes(bytes?: number): string {
  if (bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return "-";
  if (bytes === 0) return "0 B";
  const units = ["B", "KiB", "MiB", "GiB", "TiB", "PiB", "EiB"];
  const index = Math.max(0, Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024))));
  return `${(bytes / 1024 ** index).toFixed(1)} ${units[index]}`;
}

/** Preserve structured Proxmox validation errors rather than hiding them behind HTTP status. */
export function resourceErrorMessage(payload: unknown, fallback: string): string {
  if (typeof payload === "string" && payload.trim()) return payload;
  if (!payload || typeof payload !== "object") return fallback;
  const response = payload as Record<string, unknown>;
  const details = response.errors && typeof response.errors === "object"
    ? Object.entries(response.errors).map(([field, message]) => `${field}: ${String(message)}`).join("; ")
    : "";
  const message = [response.message, response.error, response.data].find((value) => typeof value === "string" && value.trim());
  return [typeof message === "string" ? message : "", details].filter(Boolean).join(" — ") || fallback;
}

export function poolMemberVmid(member: { id: string; vmid?: number }): string {
  const vmid = member.vmid === undefined ? member.id.replace(/^(?:qemu|lxc)\//, "") : String(member.vmid);
  if (!isValidVmid(vmid)) throw new Error("The selected pool member has no valid guest ID.");
  return vmid;
}

export function createStorageUploadForm(file: File, content: string): FormData {
  if (!['iso', 'vztmpl', 'import'].includes(content)) throw new Error("Unsupported storage upload content type.");
  if (!file.size) throw new Error("Choose a non-empty file to upload.");
  const formData = new FormData();
  formData.append("content", content);
  // Proxmox's multipart parser derives tmpfilename from this binary filename field.
  formData.append("filename", file, file.name);
  return formData;
}

export function setOptionalParameters(params: URLSearchParams, values: Record<string, string>, editing: boolean): void {
  const deleted = new Set((params.get("delete") ?? "").split(",").filter(Boolean));
  for (const [key, rawValue] of Object.entries(values)) {
    const value = rawValue.trim();
    if (value) {
      params.set(key, value);
      deleted.delete(key);
    } else if (editing) {
      params.delete(key);
      deleted.add(key);
    }
  }
  if (deleted.size) params.set("delete", [...deleted].join(","));
  else params.delete("delete");
}

/** Proxmox syslog's t field is line text, not a timestamp. */
export function syslogMessage(entry: { t?: number | string; msg?: string; message?: string }): string {
  return entry.msg ?? entry.message ?? (typeof entry.t === "string" ? entry.t : "-");
}

/** One offline or forbidden node must not hide resources returned by other nodes. */
export function collectResourceResults<T>(results: PromiseSettledResult<T[]>[], labels: readonly string[]): { values: T[]; errors: string[] } {
  return {
    values: results.flatMap((result) => result.status === "fulfilled" ? result.value : []),
    errors: results.flatMap((result, index) => result.status === "rejected"
      ? [`${labels[index] ?? "Resource"}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`] : []),
  };
}

export function formatNetworkCidr(network: { address?: string; cidr?: string; netmask?: string }): string {
  // The API returns cidr as a complete address/prefix, not only the prefix length.
  if (network.cidr?.includes("/")) return network.cidr;
  const address = network.address?.trim() ?? "";
  if (!address) return "";
  if (address.includes("/")) return address;
  const mask = network.cidr ?? network.netmask;
  return mask ? `${address}/${mask}` : address;
}

export function parseNetworkIpv4(value: string): { address: string; netmask: string } {
  const trimmed = value.trim();
  if (!trimmed) return { address: "", netmask: "" };
  const parts = trimmed.split("/");
  const address = parts[0].trim();
  const validAddress = (candidate: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(candidate) && candidate.split(".").every((octet) => Number(octet) <= 255);
  if (parts.length > 2 || !validAddress(address)) throw new Error("Enter a valid IPv4 address and prefix, such as 192.0.2.10/24.");
  const rawMask = parts[1]?.trim() ?? "";
  if (!rawMask) return { address, netmask: "" };
  if (rawMask.includes(".")) {
    if (!validAddress(rawMask)) throw new Error("Enter a valid IPv4 subnet mask.");
    const bits = rawMask.split(".").map((octet) => Number(octet).toString(2).padStart(8, "0")).join("");
    if (!/^1*0*$/.test(bits)) throw new Error("The IPv4 subnet mask must contain contiguous network bits.");
    return { address, netmask: rawMask };
  }
  if (!/^\d{1,2}$/.test(rawMask) || Number(rawMask) > 32) throw new Error("The IPv4 prefix must be an integer from 0 to 32.");
  const bits = Number(rawMask);
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return { address, netmask: [24, 16, 8, 0].map((shift) => (mask >>> shift) & 255).join(".") };
}

export function readPropertyValue(value: string | number | boolean | null | undefined, key: string): string {
  const text = value === null || value === undefined ? "" : String(value);
  const parts = text.split(",");
  const explicit = parts.find((part) => part.startsWith(`${key}=`));
  if (explicit !== undefined) return explicit.slice(key.length + 1);
  return parts[0]?.includes("=") ? "" : (parts[0] ?? "");
}

export function updatePropertyValue(value: string | number | boolean | null | undefined, key: string, next: string): string {
  const text = value === null || value === undefined ? "" : String(value);
  const otherProperties = text.split(",").filter((part) => part.includes("=") && !part.startsWith(`${key}=`));
  return [`${key}=${next}`, ...otherProperties].join(",");
}

export function isIntegerInRange(value: string, min: number, max = Number.MAX_SAFE_INTEGER): boolean {
  return /^\d+$/.test(value.trim()) && Number.isSafeInteger(Number(value)) && Number(value) >= min && Number(value) <= max;
}

export interface ClusterJoinInfo {
  hostname: string;
  fingerprint: string;
  links: number[];
  requiredLinks: number[];
}

/** Decode the information copied from Proxmox's Cluster Join Information window. */
export function parseClusterJoinInfo(value: string): ClusterJoinInfo | null {
  if (!value.trim()) return null;
  let parsed: unknown;
  try {
    const text = value.trim();
    parsed = JSON.parse(text.startsWith("{") ? text : new TextDecoder().decode(Uint8Array.from(atob(text), (character) => character.charCodeAt(0))));
  } catch { throw new Error("Invalid cluster join information."); }
  if (!parsed || typeof parsed !== "object") throw new Error("Invalid cluster join information.");
  const data = parsed as Record<string, unknown>;
  if (typeof data.ipAddress !== "string" || typeof data.fingerprint !== "string" || !data.totem || typeof data.totem !== "object") {
    throw new Error("Invalid cluster join information.");
  }
  const interfaces = (data.totem as Record<string, unknown>).interface;
  const links = interfaces && typeof interfaces === "object"
    ? [...new Set(Object.values(interfaces).map((item) => {
      if (!item || typeof item !== "object") throw new Error("Invalid cluster link information.");
      const iface = item as Record<string, unknown>;
      const number = Number(iface.linknumber ?? iface.ringnumber);
      if (!Number.isInteger(number) || number < 0 || number > 7) throw new Error("Invalid cluster link number.");
      return number;
    }))].sort((a, b) => a - b)
    : [0];
  if (!links.length) throw new Error("No cluster links were provided.");
  const defaultLink = links.length === 1 && links[0] === 0 && Array.isArray(data.ring_addr) && data.ring_addr[0] === data.ipAddress;
  return { hostname: data.ipAddress, fingerprint: data.fingerprint, links, requiredLinks: defaultLink ? [] : links };
}

export function buildClusterJoinParameters(form: { hostname: string; fingerprint: string; password: string; links: Record<string, string> }, info: ClusterJoinInfo | null): URLSearchParams {
  if (!form.hostname.trim() || /[\s,=]/.test(form.hostname.trim())) throw new Error("Enter the existing cluster node's hostname or IP address.");
  if (!/^([a-f\d]{2}:){31}[a-f\d]{2}$/i.test(form.fingerprint.trim())) throw new Error("Enter a valid SHA-256 certificate fingerprint (32 hexadecimal byte pairs).");
  if (!form.password || form.password.length > 128) throw new Error("Enter the peer node's root password (up to 128 characters).");
  const parameters = new URLSearchParams({ hostname: form.hostname.trim(), fingerprint: form.fingerprint.trim(), password: form.password });
  for (const number of info?.links ?? [0]) {
    const address = form.links[String(number)]?.trim() ?? "";
    if (!address && info?.requiredLinks.includes(number)) throw new Error(`Enter this node's address for cluster link ${number}.`);
    if (address) {
      if (/[\s,=]/.test(address)) throw new Error(`Enter a hostname or IP address for cluster link ${number}.`);
      parameters.set(`link${number}`, `address=${address}`);
    }
  }
  return parameters;
}
