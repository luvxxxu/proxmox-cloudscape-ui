import type { Metadata } from "next";
import "@cloudscape-design/global-styles/index.css";
import "@xterm/xterm/css/xterm.css";
import AppShell from "./components/app-shell";

// CSP script nonces must be generated per request, including the login page.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Proxmox Dashboard",
  description: "Proxmox VE management dashboard",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
