import { defineConfig, devices } from "@playwright/test";

/**
 * E2E tests run against a server started with a DISPOSABLE demo database
 * (SEED_DEMO_DATA=true). They create records, so never point them at production.
 *   BASE_URL=http://localhost:3000 npm run test:e2e
 */
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH || (process.env.PLAYWRIGHT_BROWSERS_PATH ? undefined : undefined);

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.BASE_URL || "http://localhost:3000",
    trace: "retain-on-failure",
    launchOptions: executablePath ? { executablePath } : {},
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1366, height: 860 } }, testIgnore: /mobile/ },
    { name: "mobile", use: { ...devices["Pixel 7"] }, testMatch: /mobile/ },
  ],
  webServer: process.env.BASE_URL
    ? undefined
    : { command: "npm run start", url: "http://localhost:3000/login", reuseExistingServer: true, timeout: 120_000 },
});
