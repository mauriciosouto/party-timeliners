import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    globals: false,
    env: {
      DB_PATH: "test-data/integration.db",
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary", "html"],
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.test.ts",
        "src/**/*.integration.test.ts",
        "src/db/seed.ts",
        "src/index.ts",
        "src/db/ensureEventPool.ts",
        "src/routes/**",
        "src/ws/**",
        "src/types.ts",
        "src/config.ts",
        "src/game/index.ts",
        "**/*.d.ts",
      ],
    },
  },
  resolve: {
    alias: {
      "#": path.resolve(__dirname, "./src"),
    },
  },
});
