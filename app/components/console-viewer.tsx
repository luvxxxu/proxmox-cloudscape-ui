"use client";

import dynamic from "next/dynamic";
import type { ConsoleSession } from "@/app/lib/console-session";

const VncViewer = dynamic(() => import("@/app/components/vnc-viewer"), { ssr: false });
const XtermViewer = dynamic(() => import("@/app/components/xterm-viewer"), { ssr: false });

interface ConsoleViewerProps {
  session: ConsoleSession;
  onConnect: () => void;
  onDisconnect: (clean: boolean, reason?: string) => void;
}

export default function ConsoleViewer({ session, onConnect, onDisconnect }: ConsoleViewerProps) {
  if (session.mode === "xterm") {
    return (
      <XtermViewer
        wsUrl={session.wsUrl}
        ticket={session.ticket}
        user={session.user}
        onConnect={onConnect}
        onDisconnect={onDisconnect}
      />
    );
  }

  return (
    <VncViewer
      wsUrl={session.wsUrl}
      vncPassword={session.password ?? session.ticket}
      onConnect={onConnect}
      onDisconnect={onDisconnect}
    />
  );
}
