"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Container from "@cloudscape-design/components/container";
import Header from "@cloudscape-design/components/header";
import SegmentedControl from "@cloudscape-design/components/segmented-control";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Spinner from "@cloudscape-design/components/spinner";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import ConsoleViewer from "@/app/components/console-viewer";
import type { ConsoleMode, ConsoleSession } from "@/app/lib/console-session";
import { useTranslation } from "@/app/lib/use-translation";
import { apiFetch } from "@/app/lib/api-client";
import { buildWsRelayUrl } from "@/app/lib/ws-relay-url";

interface ClusterContainerResource {
  vmid: number;
  node?: string;
  name?: string;
  status?: string;
  type?: string;
}

type ConnectionStatus = "idle" | "connecting" | "connected" | "disconnected" | "error";

async function fetchJson<T>(path: string, errorMessage: string, signal: AbortSignal): Promise<T> {
  const res = await apiFetch(path, { signal });
  if (!res.ok) throw new Error(errorMessage);
  const json = await res.json();
  return (json.data ?? json) as T;
}

export default function ContainerConsolePage() {
  const { t } = useTranslation();
  const translation = useRef(t);
  useEffect(() => { translation.current = t; }, [t]);
  const params = useParams<{ ctid: string }>();
  const router = useRouter();
  const [containerName, setContainerName] = useState<string | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [mode, setMode] = useState<ConsoleMode>("xterm");
  const [session, setSession] = useState<ConsoleSession | null>(null);

  const vmid = useMemo(() => Number(params.ctid), [params.ctid]);

  const handleConnect = useCallback(() => setStatus("connected"), []);
  const handleDisconnect = useCallback((clean: boolean, reason?: string) => {
    if (clean) {
      setStatus("disconnected");
    } else {
      setError(reason ?? t("console.connectionLost"));
      setStatus("error");
    }
  }, [t]);

  useEffect(() => {
    if (!Number.isSafeInteger(vmid) || vmid < 100 || vmid > 999999999) return;

    let cancelled = false;
    const controller = new AbortController();
    // A new external console connection must replace the previous session and status.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setError(null);
    setStatus("connecting");
    setSession(null);

    const connect = async () => {
      try {
        const resources = await fetchJson<ClusterContainerResource[]>(
          "/api/proxmox/cluster/resources?type=vm",
          translation.current("containers.failedRequest"),
          controller.signal,
        );

        const resource = (resources ?? []).find(
          (r) => r.type === "lxc" && r.vmid === vmid && r.node,
        );
        if (!resource?.node) throw new Error(translation.current("containers.failedRequest"));
        if (resource.status !== "running") throw new Error(translation.current("containers.failedRequest"));

        if (cancelled) return;
        setContainerName(resource.name ?? null);

        const consoleRes = await apiFetch("/api/console", {
          method: "POST",
          signal: controller.signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ node: resource.node, vmid, vmtype: "lxc", mode }),
        });
        if (!consoleRes.ok) throw new Error(translation.current("console.failedToConnect"));
        const consoleData = await consoleRes.json();
        if (cancelled) return;
        if (consoleData.error) throw new Error(consoleData.error);

        if (cancelled) return;

        const wsParams = new URLSearchParams({
          node: resource.node,
          vmid: String(vmid),
          type: "lxc",
          ticket: consoleData.ticket,
          port: String(consoleData.port),
        });
        const wsUrl = buildWsRelayUrl(window.location, wsParams);

        setSession({
          mode,
          wsUrl,
          ticket: consoleData.ticket,
          user: consoleData.user,
          password: consoleData.password,
        });
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : translation.current("console.failedToConnect"));
        setStatus("error");
      }
    };

    void connect();
    return () => {
      cancelled = true; controller.abort();
    };
  }, [vmid, mode, attempt]);

  const title = containerName ? `${containerName} (${vmid})` : `CT ${vmid}`;

  const statusType = status === "connected" ? "success" as const
    : status === "connecting" ? "in-progress" as const
    : status === "error" ? "error" as const
    : "stopped" as const;

  const statusLabel = status === "connected" ? t("console.connected")
    : status === "connecting" ? t("console.connecting")
    : status === "error" ? t("common.error")
    : t("console.disconnected");

  return (
    <SpaceBetween size="m">
      {(error || !Number.isSafeInteger(vmid) || vmid < 100 || vmid > 999999999) && <Alert type="error" header={t("console.consoleError")}>{error || t("vms.vmIdInvalid")}</Alert>}
      <Header
        variant="h1"
        actions={
          <SpaceBetween size="xs" direction="horizontal">
            <SegmentedControl
              selectedId={mode}
              onChange={({ detail }) => setMode(detail.selectedId as ConsoleMode)}
              options={[
                { id: "novnc", text: "noVNC" },
                { id: "xterm", text: "xterm.js" },
              ]}
              label={t("console.viewer")}
            />
            <StatusIndicator type={statusType}>{statusLabel}</StatusIndicator>
            <Button disabled={status === "connecting"} onClick={() => setAttempt((n) => n + 1)}>{t("console.reconnect")}</Button>
            <Button onClick={() => router.push(`/containers/${vmid}`)}>{t("console.backToContainer")}</Button>
          </SpaceBetween>
        }
      >
        {title} — {t("console.console")}
      </Header>
      <Container>
        {status === "connecting" && !session && (
          <Box textAlign="center" padding="l"><Spinner size="large" /></Box>
        )}
        {session?.mode === mode && (
          <ConsoleViewer
            session={session}
            onConnect={handleConnect}
            onDisconnect={handleDisconnect}
          />
        )}
      </Container>
    </SpaceBetween>
  );
}
