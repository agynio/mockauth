import fs from "node:fs";
import path from "node:path";

import { defineConfig, devices } from "@playwright/test";

const projectRoot = process.cwd();
const ldLibrarySegments = (process.env.PLAYWRIGHT_LD_LIBRARY_PATH ?? "")
  .split(":")
  .map((segment) => segment.trim())
  .filter(Boolean)
  .map((segment) =>
    path.isAbsolute(segment) ? segment : path.resolve(projectRoot, segment),
  );

const headlessShellPath = path.resolve(
  projectRoot,
  ".playwright-browsers",
  "chromium_headless_shell-1208",
  "chrome-linux",
  "headless_shell",
);

const chromiumLdLibraryPath = [
  "/usr/lib/x86_64-linux-gnu",
  "/lib/x86_64-linux-gnu",
  ...ldLibrarySegments,
  path.dirname(headlessShellPath),
]
  .filter(Boolean)
  .join(":");

const chromiumExecutablePath = (() => {
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE) {
    return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  }

  if (process.arch === "x64" && fs.existsSync(headlessShellPath)) {
    return headlessShellPath;
  }

  const fullChromiumBinary = path.resolve(
    projectRoot,
    ".playwright-browsers",
    "chromium-1208",
    "chrome-linux",
    "chrome",
  );

  return fullChromiumBinary;
})();

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 120_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000",
    trace: "on-first-retry",
    launchOptions: {
      executablePath: chromiumExecutablePath,
      env: {
        ...process.env,
        LD_LIBRARY_PATH: chromiumLdLibraryPath,
      },
    },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command:
      process.env.PLAYWRIGHT_WEB_SERVER_CMD ??
      "pnpm build && pnpm exec next start --hostname 127.0.0.1 --port 3000",
    url: "http://127.0.0.1:3000/api/health",
    reuseExistingServer: !process.env.CI,
    stdout: "pipe",
    stderr: "pipe",
  },
});
