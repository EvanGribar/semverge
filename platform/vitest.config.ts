import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { include: ["platform/tests/**/*.test.ts"], testTimeout: 15000 },
});
