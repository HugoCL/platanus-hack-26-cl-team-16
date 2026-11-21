import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const path = (dir: string) => fileURLToPath(new URL(dir, import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\/convex\//, replacement: path("./convex/") },
      { find: /^@\/shared\//, replacement: path("./shared/") },
      { find: /^@\//, replacement: path("./src/") },
    ],
  },
  test: {
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    env: { LLM_PROVIDER: "fake", BUSINESS_SOURCES: "fixture" },
  },
});
