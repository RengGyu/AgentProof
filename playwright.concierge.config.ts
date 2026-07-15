import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  outputDir: "/private/tmp/agentproof-concierge-playwright-results",
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:3108",
    browserName: "chromium",
    channel: "chrome",
    headless: true,
    trace: "off",
    screenshot: "off",
    video: "off"
  },
  webServer: {
    command: "pnpm start -p 3108",
    url: "http://127.0.0.1:3108/concierge",
    reuseExistingServer: true,
    timeout: 30_000
  }
});
