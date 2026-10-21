import { defineConfig, devices } from "@playwright/test";

/** Persona runs (tests/personas): 50 people using the site their own way, against the local stack only. */
const PORT = Number(process.env.PORT ?? 3100);
export default defineConfig({
  testDir: "tests/personas",
  timeout: 300_000,
  workers: Number(process.env.PERSONA_WORKERS ?? 4),
  retries: 0,
  fullyParallel: true,
  outputDir: "test-results/pw-personas",
  reporter: [["list"]],
  use: {
    actionTimeout: 15_000,
    navigationTimeout: 45_000,
    baseURL: `http://localhost:${PORT}`,
    launchOptions: { executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" },
    ...devices["Desktop Chrome"],
    viewport: { width: 1440, height: 900 },
  },
  webServer: { command: `npm run start -- -p ${PORT}`, port: PORT, reuseExistingServer: true, timeout: 120_000 },
});
