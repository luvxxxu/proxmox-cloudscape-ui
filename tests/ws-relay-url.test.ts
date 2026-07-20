import { describe, expect, it } from "vitest";
import { buildWsRelayUrl } from "@/app/lib/ws-relay-url";

describe("buildWsRelayUrl", () => {
  it("targets the page origin", () => {
    const url = buildWsRelayUrl(
      { protocol: "http:", host: "localhost:3000" },
      new URLSearchParams({ node: "n", type: "qemu" }),
    );

    expect(url).toBe("ws://localhost:3000/ws?node=n&type=qemu");
  });

  it("uses wss on https origins", () => {
    const url = buildWsRelayUrl(
      { protocol: "https:", host: "example.com:443" },
      new URLSearchParams({ node: "n", type: "qemu" }),
    );

    expect(url).toBe("wss://example.com:443/ws?node=n&type=qemu");
  });
});
