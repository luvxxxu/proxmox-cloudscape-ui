"use client";

import { useEffect, useRef } from "react";
import RFB from "novnc";

interface VncViewerProps {
  wsUrl: string;
  vncPassword: string;
  onConnect: () => void;
  onDisconnect: (clean: boolean, reason?: string) => void;
}

type RfbWithConnectionState = RFB & {
  _rfbConnectionState?: string;
};

export default function VncViewer({ wsUrl, vncPassword, onConnect, onDisconnect }: VncViewerProps) {
  const displayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const display = displayRef.current;
    if (!display) return;

    let rfb: RFB | null = null;
    let disconnected = false;
    let removeListeners = () => {};

    const startTimer = setTimeout(() => {
      display.innerHTML = "";

      const instance = new RFB(display, wsUrl, {
        credentials: { password: vncPassword },
      });
      rfb = instance;

      instance.scaleViewport = true;
      instance.resizeSession = true;
      instance.qualityLevel = 8;
      instance.compressionLevel = 0;

      const handleCredentialsRequired = () => {
        instance.sendCredentials({ password: vncPassword });
      };
      const handleDisconnectEvent = (event: { detail: { clean: boolean; reason?: string } }) => {
        disconnected = true;
        onDisconnect(event.detail.clean, event.detail.reason);
      };

      instance.addEventListener("connect", onConnect);
      instance.addEventListener("credentialsrequired", handleCredentialsRequired);
      instance.addEventListener("disconnect", handleDisconnectEvent);

      removeListeners = () => {
        instance.removeEventListener("connect", onConnect);
        instance.removeEventListener("credentialsrequired", handleCredentialsRequired);
        instance.removeEventListener("disconnect", handleDisconnectEvent);
      };
    }, 0);

    return () => {
      clearTimeout(startTimer);
      removeListeners();
      const connectionState = (rfb as RfbWithConnectionState | null)?._rfbConnectionState;
      if (rfb && !disconnected && connectionState !== "disconnected") rfb.disconnect();
    };
  }, [wsUrl, vncPassword, onConnect, onDisconnect]);

  return (
    <div
      ref={displayRef}
      style={{
        width: "100%",
        height: "calc(100vh - 220px)",
        minHeight: 480,
        background: "#000",
      }}
    />
  );
}
