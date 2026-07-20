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
import type { ConsoleMode, ConsoleSession } from "@/app/lib/console-session";
import { useTranslation } from "@/app/lib/use-translation";
import { buildWsRelayUrl } from "@/app/lib/ws-relay-url";

type ConnectionStatus = "idle" | "connecting" | "connected" | "disconnected" | "error";

export default function NodeShellPage() {
  const { t } = useTranslation();
  const params = useParams<{ node: string }>();
  const router = useRouter();
  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [mode, setMode] = useState<ConsoleMode>("xterm");
  const [session, setSession] = useState<ConsoleSession | null>(null);

  const node = useMemo(() => params.node, [params.node]);

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
    if (!node) return;

    let cancelled = false;
    setError(null);
    setStatus("connecting");
    setSession(null);

    const connect = async () => {
      try {
        const consoleRes = await fetch("/api/console/node", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ node, mode }),
        });
        const consoleData = await consoleRes.json();
        if (!consoleRes.ok || consoleData.error) {
          throw new Error(consoleData.error ?? t("console.failedToConnect"));
        }

        if (cancelled) return;

        const wsParams = new URLSearchParams({
          node,
          type: "shell",
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
  }, [node, mode, attempt, t]);

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
                { id: "xterm", text: "xterm.js" },
              ]}
              label={t("console.viewer")}
            />
            <StatusIndicator type={statusType}>{statusLabel}</StatusIndicator>
            <Button disabled={status === "connecting"} onClick={() => setAttempt((n) => n + 1)}>{t("console.reconnect")}</Button>
            <Button onClick={() => router.push(`/nodes/${node}`)}>{t("common.back")}</Button>
          </SpaceBetween>
        }
      >
        {node} — {t("nodeDetail.shell")}
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
