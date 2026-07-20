"use client";

import { useEffect, useRef } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";

interface XtermViewerProps {
  wsUrl: string;
  ticket: string;
  user: string;
  onConnect: () => void;
  onDisconnect: (clean: boolean, reason?: string) => void;
}

const encoder = new TextEncoder();

async function toBytes(data: string | ArrayBuffer | Blob): Promise<Uint8Array> {
  if (typeof data === "string") return encoder.encode(data);
  if (data instanceof Blob) return new Uint8Array(await data.arrayBuffer());
  return new Uint8Array(data);
}

export default function XtermViewer({ wsUrl, ticket, user, onConnect, onDisconnect }: XtermViewerProps) {
  const terminalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = terminalRef.current;
    if (!container) return;

    let cleanup = () => {};
    const startTimer = setTimeout(() => {
      const terminal = new Terminal({
        cursorBlink: true,
        fontFamily: "Menlo, Monaco, Consolas, 'Liberation Mono', monospace",
        fontSize: 14,
        scrollback: 5000,
        theme: {
          background: "#0d1117",
          foreground: "#e6edf3",
          cursor: "#ffffff",
          selectionBackground: "#264f78",
        },
      });
      const fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);
      terminal.open(container);

      const socket = new WebSocket(wsUrl, "binary");
      socket.binaryType = "arraybuffer";

      let authenticated = false;
      let disposed = false;
      let disconnectReported = false;
      let keepalive: ReturnType<typeof setInterval> | undefined;
      let fitFrame: number | undefined;

      const reportDisconnect = (clean: boolean, reason?: string) => {
        if (disposed || disconnectReported) return;
        disconnectReported = true;
        onDisconnect(clean, reason);
      };

      const sendResize = () => {
        if (authenticated && socket.readyState === WebSocket.OPEN) {
          socket.send(`1:${terminal.cols}:${terminal.rows}:`);
        }
      };

      const fit = () => {
        if (fitFrame !== undefined) cancelAnimationFrame(fitFrame);
        fitFrame = requestAnimationFrame(() => {
          fitFrame = undefined;
          if (disposed || !container.isConnected) return;
          try {
            fitAddon.fit();
            sendResize();
          } catch {
            // The terminal can briefly have no measurable dimensions during navigation.
          }
        });
      };

      const resizeObserver = new ResizeObserver(fit);
      resizeObserver.observe(container);

      const dataDisposable = terminal.onData((data) => {
        if (authenticated && socket.readyState === WebSocket.OPEN) {
          socket.send(`0:${encoder.encode(data).byteLength}:${data}`);
        }
      });

      socket.addEventListener("open", () => {
        if (disposed) {
          socket.close(1000, "Console closed");
          return;
        }

        socket.send(`${user}:${ticket}\n`);
        keepalive = setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) socket.send("2");
        }, 30_000);
      });

      socket.addEventListener("message", (event) => {
        void toBytes(event.data as string | ArrayBuffer | Blob).then((bytes) => {
          if (disposed) return;

          if (!authenticated) {
            if (bytes.length < 2 || bytes[0] !== 79 || bytes[1] !== 75) {
              reportDisconnect(false, "Proxmox terminal authentication failed");
              socket.close(1000, "Terminal authentication failed");
              return;
            }

            authenticated = true;
            onConnect();
            terminal.focus();
            fit();
            if (bytes.length > 2) terminal.write(bytes.subarray(2));
            return;
          }

          terminal.write(bytes);
        });
      });

      socket.addEventListener("close", (event) => {
        if (keepalive) clearInterval(keepalive);
        reportDisconnect(event.wasClean && event.code === 1000, event.reason || undefined);
      });

      socket.addEventListener("error", () => {
        reportDisconnect(false, "WebSocket connection failed");
      });

      fit();

      cleanup = () => {
        disposed = true;
        if (keepalive) clearInterval(keepalive);
        if (fitFrame !== undefined) cancelAnimationFrame(fitFrame);
        resizeObserver.disconnect();
        dataDisposable.dispose();
        terminal.dispose();

        if (socket.readyState === WebSocket.OPEN) {
          socket.close(1000, "Console closed");
        }
      };
    }, 0);

    return () => {
      clearTimeout(startTimer);
      cleanup();
    };
  }, [wsUrl, ticket, user, onConnect, onDisconnect]);

  return (
    <div
      style={{
        width: "100%",
        height: "calc(100vh - 240px)",
        minHeight: 480,
        padding: 12,
        boxSizing: "border-box",
        overflow: "hidden",
        background: "#0d1117",
      }}
    >
      <div ref={terminalRef} style={{ width: "100%", height: "100%" }} />
    </div>
  );
}
