import { defineConfig, devices } from "@playwright/test";
import { E2E_HOSTS, E2E_PORT } from "./e2e/settings";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    ...devices["Desktop Chrome"],
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: { args: ["--host-resolver-rules=MAP jdsrv 127.0.0.1, MAP jdsrv.local 127.0.0.1", "--no-proxy-server"] },
  },
  projects: E2E_HOSTS.map(host => ({ name: host, use: { baseURL: `http://${host}:${E2E_PORT}` } })),
  webServer: {
    command: "node --import tsx e2e/server.ts",
    url: `http://localhost:${E2E_PORT}/login`,
    reuseExistingServer: false,
    timeout: 120_000,
    gracefulShutdown: { signal: "SIGTERM", timeout: 5000 },
  },
});
