"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
import {
  hasQemuSerialInterface,
  type ConsoleMode,
  type ConsoleSession,
} from "@/app/lib/console-session";
import { useTranslation } from "@/app/lib/use-translation";
import { buildWsRelayUrl } from "@/app/lib/ws-relay-url";

interface ClusterVmResource {
  vmid: number;
  node?: string;
  name?: string;
  status?: string;
  type?: string;
}

type ConnectionStatus = "idle" | "connecting" | "connected" | "disconnected" | "error";

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  const json = await res.json();
  return (json.data ?? json) as T;
}

export default function VmConsolePage() {
  const { t } = useTranslation();
  const params = useParams<{ vmid: string }>();
  const router = useRouter();
  const [vmName, setVmName] = useState<string | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [mode, setMode] = useState<ConsoleMode>("novnc");
  const [session, setSession] = useState<ConsoleSession | null>(null);
  const [xtermAvailable, setXtermAvailable] = useState<boolean | null>(null);

  const vmid = useMemo(() => Number(params.vmid), [params.vmid]);

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
    if (!Number.isFinite(vmid)) return;

    let cancelled = false;
    setError(null);
    setStatus("connecting");
    setSession(null);

    const connect = async () => {
      try {
        const resources = await fetchJson<ClusterVmResource[]>(
          "/api/proxmox/cluster/resources?type=vm",
        );

        const resource = (resources ?? []).find(
          (r) => r.type === "qemu" && r.vmid === vmid && r.node,
        );
        if (!resource?.node) throw new Error(`VM ${vmid} not found`);
        if (resource.status !== "running") throw new Error(`VM ${vmid} is not running`);

        setVmName(resource.name ?? null);
        if (cancelled) return;

        let serialAvailable: boolean | null = null;
        try {
          const vmConfig = await fetchJson<Record<string, unknown>>(
            `/api/proxmox/nodes/${encodeURIComponent(resource.node)}/qemu/${vmid}/config`,
          );
          serialAvailable = hasQemuSerialInterface(vmConfig);
        } catch {
          // A console-only role may not be allowed to read the VM configuration.
        }

        if (cancelled) return;
        setXtermAvailable(serialAvailable);

        if (mode === "xterm" && serialAvailable === false) {
          setMode("novnc");
          return;
        }

        const consoleRes = await fetch("/api/console", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ node: resource.node, vmid, vmtype: "qemu", mode }),
        });
        const consoleData = await consoleRes.json();
        if (consoleData.code === "SERIAL_INTERFACE_REQUIRED") {
          setXtermAvailable(false);
          setMode("novnc");
          return;
        }
        if (!consoleRes.ok || consoleData.error) {
          throw new Error(consoleData.error ?? t("console.failedToConnect"));
        }

        if (cancelled) return;

        const wsParams = new URLSearchParams({
          node: resource.node,
          vmid: String(vmid),
          type: "qemu",
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
        setError(err instanceof Error ? err.message : t("console.failedToConnect"));
        setStatus("error");
      }
    };

    void connect();
    return () => { cancelled = true; };
  }, [vmid, mode, attempt, t]);

  const title = vmName ? `${vmName} (${vmid})` : `${t("dashboard.virtualMachines")} ${vmid}`;

  const statusType = status === "connected"
    ? ("success" as const)
    : status === "connecting"
      ? ("in-progress" as const)
      : status === "error"
        ? ("error" as const)
        : ("stopped" as const);

  const statusLabel = status === "connected"
    ? t("console.connected")
    : status === "connecting"
      ? t("console.connecting")
      : status === "error"
        ? t("common.error")
        : t("console.disconnected");

  return (
    <SpaceBetween size="m">
      {error && <Alert type="error" header={t("console.consoleError")}>{error}</Alert>}
      <Header
        variant="h1"
        actions={
          <SpaceBetween size="xs" direction="horizontal">
            <SegmentedControl
              selectedId={mode}
              onChange={({ detail }) => setMode(detail.selectedId as ConsoleMode)}
              options={[
                { id: "novnc", text: "noVNC" },
                {
                  id: "xterm",
                  text: "xterm.js",
                  disabled: xtermAvailable === false,
                  disabledReason: t("console.serialInterfaceRequired"),
                },
              ]}
              label={t("console.viewer")}
            />
            <StatusIndicator type={statusType}>{statusLabel}</StatusIndicator>
            <Button disabled={status === "connecting"} onClick={() => setAttempt((n) => n + 1)}>{t("console.reconnect")}</Button>
            <Button onClick={() => router.push(`/vms/${vmid}`)}>{t("console.backToVm")}</Button>
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
