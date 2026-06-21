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
    testTimeout: 30_000,
    setupFiles: ["dotenv/config"],
  },
});
