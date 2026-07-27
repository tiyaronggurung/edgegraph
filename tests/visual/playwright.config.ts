import { defineConfig, devices } from "@playwright/test";

// Manual-only visual regression harness for TrendlineChartPanel pills.
// Run with: bun run test:visual
export default defineConfig({
  testDir: ".",
  testMatch: /.*\.visual\.ts$/,
  fullyParallel: false,

  reporter: [["list"]],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: process.env.VISUAL_BASE_URL ?? "http://localhost:8080",
    viewport: { width: 1280, height: 1800 },
    ignoreHTTPSErrors: true,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  snapshotDir: "./__snapshots__",
});
