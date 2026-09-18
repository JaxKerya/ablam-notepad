import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  testMatch: "jobs.spec.ts",
  fullyParallel: false,
  workers: 1,
  use: { baseURL: "http://localhost:3100", channel: process.env.PLAYWRIGHT_CHANNEL || undefined, headless: true, screenshot: "only-on-failure" },
  webServer: { command: "node node_modules/next/dist/bin/next start -p 3100", url: "http://localhost:3100", reuseExistingServer: true, timeout: 60000 },
});
