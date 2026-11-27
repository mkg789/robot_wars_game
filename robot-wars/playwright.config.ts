import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium, defineConfig } from "@playwright/test";

function resolveChromiumExecutable(): string | undefined {
  const candidates = [
    process.env.PLAYWRIGHT_EXECUTABLE_PATH,
    chromium.executablePath(),
    path.join(
      os.homedir(),
      "AppData",
      "Local",
      "ms-playwright",
      "chromium-1200",
      "chrome-win64",
      "chrome.exe"
    ),
    path.join(
      os.homedir(),
      "AppData",
      "Local",
      "ms-playwright",
      "chromium_headless_shell-1200",
      "chrome-headless-shell-win64",
      "chrome-headless-shell.exe"
    ),
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  ].filter((candidate): candidate is string => Boolean(candidate));

  return candidates.find((candidate) => fs.existsSync(candidate));
}

const executablePath = resolveChromiumExecutable();
const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: path.join(os.tmpdir(), "robot-wars-playwright-results"),
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4173",
    viewport: { width: 1280, height: 800 },
    headless: true,
    launchOptions: {
      ...(executablePath ? { executablePath } : {}),
      args: [
        "--use-gl=angle",
        "--use-angle=swiftshader",
        "--enable-webgl",
        "--ignore-gpu-blocklist",
      ],
    },
  },
  webServer: {
    command: `${npxCommand} vite --host 127.0.0.1 --port 4173 --strictPort --configLoader runner`,
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
