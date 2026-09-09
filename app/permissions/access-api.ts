import { apiFetch } from "@/app/lib/api-client";

export class AccessApiError extends Error {
  constructor(message: string, readonly status: number, readonly fields: Record<string, string> = {}) {
    super(message);
    this.name = "AccessApiError";
  }
}

export function accessErrorMessage(body: unknown, fallback: string): { message: string; fields: Record<string, string> } {
  const record = typeof body === "object" && body !== null ? body as Record<string, unknown> : {};
  const errors = typeof record.errors === "object" && record.errors !== null ? record.errors : {};
  const fields = Object.fromEntries(Object.entries(errors).filter((pair): pair is [string, string] => typeof pair[1] === "string"));
  const detail = Object.entries(fields).map(([key, value]) => `${key}: ${value}`).join("; ");
  const message = [record.message, record.error, record.data].find((value) => typeof value === "string" && value.trim()) as string | undefined;
  return { message: detail ? `${message ?? fallback}: ${detail}` : message ?? fallback, fields };
}

export async function accessRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(path, { ...init, maxRetries: 0 });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const { message, fields } = accessErrorMessage(body, `Proxmox API (${response.status})`);
    throw new AccessApiError(message, response.status, fields);
  }
  if (typeof body !== "object" || body === null || !("data" in body)) {
    throw new AccessApiError("Invalid Proxmox API response", response.status);
  }
  return (body as { data: T }).data;
}

export function formRequest(method: string, params: URLSearchParams): RequestInit {
  return { method, headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" }, body: params.toString() };
}
