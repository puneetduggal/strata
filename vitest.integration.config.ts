import { defineConfig } from "vitest/config";
import path from "path";

// Task 21 — isolated integration config. The integration test TRUNCATEs the shared knowledge tables
// and asserts GLOBAL CQ answers, so it must run ALONE and SERIALLY (single fork) — it cannot share
// the parallel, no-truncate unit pass (vitest.config.ts excludes it for exactly that reason).
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "."),
    },
  },
  test: {
    environment: "node",
    include: ["test/integration.test.ts"],
    testTimeout: 60_000,
    setupFiles: ["dotenv/config"],
    // Serial / single-process: fileParallelism:false forces maxWorkers to 1 (Vitest 4), so the one
    // integration file runs alone in its own fork — no race with anything sharing the Postgres.
    fileParallelism: false,
  },
});
