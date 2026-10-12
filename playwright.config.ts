import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.PORT ?? 3100);
const local = !process.env.CI;

export default defineConfig({
  testDir: "tests",
  // tests/e2e runs anywhere; tests/e2e-auth needs the local Supabase (scripts/local-supabase/start.sh) and E2E_AUTH=1.
  testMatch: ["e2e/**/*.spec.ts", "e2e-auth/**/*.spec.ts"],
  timeout: 60_000,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`,
    launchOptions: local ? { executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" } : {},
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "mobile", use: { ...devices["Pixel 7"] }, testIgnore: "e2e-auth/**" },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : { command: `npm run start -- -p ${PORT}`, port: PORT, reuseExistingServer: true, timeout: 120_000 },
});
