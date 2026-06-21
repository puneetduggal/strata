import { defineConfig } from "vitest/config";
import path from "path";
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "."),
    },
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // Integration tests truncate the shared DB + assert global answers — they run alone via
    // vitest.integration.config.ts and MUST stay out of the parallel, no-truncate unit pass.
    exclude: ["**/node_modules/**", "**/dist/**", "**/.{idea,git,cache,output,temp}/**", "test/integration.test.ts"],
    testTimeout: 30_000,
    setupFiles: ["dotenv/config"],
  },
});
