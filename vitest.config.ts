import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@server": fileURLToPath(new URL("./server", import.meta.url)), "@shared": fileURLToPath(new URL("./shared", import.meta.url)), "@web": fileURLToPath(new URL("./web", import.meta.url)) } },
  test: { environment: "node", include: ["server/**/*.test.ts", "shared/**/*.test.ts", "web/**/*.test.ts"], testTimeout: 60_000, hookTimeout: 60_000 },
});
