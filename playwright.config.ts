import { existsSync } from "node:fs";
import { defineConfig } from "@playwright/test";

// umlify targets Chrome and Brave. Use Chrome when it is installed, else
// Brave; UMLIFY_BROWSER overrides with any Chromium executable.
const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const brave = "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser";
const executablePath = process.env.UMLIFY_BROWSER ?? [chrome, brave].find((p) => existsSync(p));

const port = 5174;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
  },
  webServer: {
    command: `npm run dev -w @umlify/web -- --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: !process.env.CI,
  },
});
