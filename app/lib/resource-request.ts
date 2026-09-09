"use client";

import { useEffect } from "react";
import { apiFetch } from "@/app/lib/api-client";
import { resourceErrorMessage } from "@/app/lib/resource-api";

export async function requestResource<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (!headers.has("Content-Type") && typeof init?.body === "string" && /^[{[]/.test(init.body.trimStart())) {
    headers.set("Content-Type", "application/json");
  }
  const response = await apiFetch(path, { ...init, headers });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(resourceErrorMessage(payload, `Request failed (HTTP ${response.status}).`));
  if (!payload || typeof payload !== "object" || !("data" in payload)) {
    throw new Error("Proxmox returned an invalid response. Refresh and try again.");
  }
  const result = (payload as { data: T }).data;
  if (typeof window !== "undefined" && typeof result === "string" && result.startsWith("UPID:") && init?.method && init.method !== "GET") {
    const fields = result.split(":");
    const node = fields[1];
    if (node) window.dispatchEvent(new CustomEvent("proxmox-task-started", { detail: { upid: result, node, description: `${fields[5] || init.method}${fields[6] ? ` ${fields[6]}` : ""}` } }));
  }
  return result;
}

/** Refresh resource collections after the upstream task finishes, not merely after it queues. */
export function useResourceTaskRefresh(refresh: () => void | Promise<void>): void {
  useEffect(() => {
    const handler = () => { void refresh(); };
    window.addEventListener("proxmox-task-finished", handler);
    return () => window.removeEventListener("proxmox-task-finished", handler);
  }, [refresh]);
}
