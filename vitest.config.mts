import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    // Cloudscape transforms are memory/CPU intensive. Keep installation checks
    // within the two-core LXC/CI budget without relaxing assertion timeouts.
    maxWorkers: 2,
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    server: {
      // Cloudscape publishes ESM in .js files under CommonJS package boundaries.
      // Transform its packages together so the runtime resolves named exports.
      deps: { inline: [/@cloudscape-design\//] },
    },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
});
