import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "server-only": path.resolve(__dirname, "tests/helpers/empty.ts"),
    },
  },
  test: {
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    environment: "node",
    // Integration tests share one PostgreSQL test database — run files serially.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    globalSetup: ["tests/helpers/global-setup.ts"],
    env: {
      TZ: "UTC",
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgresql://aed:aed_dev_pw@localhost:5432/aed_test?schema=public",
      DIRECT_URL: process.env.TEST_DATABASE_URL ?? "postgresql://aed:aed_dev_pw@localhost:5432/aed_test?schema=public",
      UPLOAD_DIR: path.resolve(__dirname, ".test-uploads"),
      APP_TIMEZONE: "Asia/Kolkata",
    },
  },
});
