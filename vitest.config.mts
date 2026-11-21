import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    env: { LLM_PROVIDER: "fake", BUSINESS_SOURCES: "fixture" },
  },
});
