import path from "node:path";
import { mkdir } from "node:fs/promises";

import { chromium, devices } from "playwright";

const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const OUTPUT_DIR = path.resolve(process.cwd(), "docs/qa");

const waitForIdle = async (timeout = 1000) => new Promise((resolve) => setTimeout(resolve, timeout));

async function ensureOutputDir() {
  await mkdir(OUTPUT_DIR, { recursive: true });
}

async function captureHeroDesktop(browser: string) {
  const instance = await chromium.launch();
  try {
    const page = await instance.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(`${BASE_URL}/`, { waitUntil: "networkidle" });
    await waitForIdle(800);
    await page.screenshot({ path: path.join(OUTPUT_DIR, `${browser}-hero-desktop.png`), fullPage: true });
  } finally {
    await instance.close();
  }
}

async function captureHeroMobile(browser: string) {
  const instance = await chromium.launch();
  try {
    const mobileContext = await instance.newContext({ ...devices["iPhone 14"], locale: "en-US" });
    const page = await mobileContext.newPage();
    await page.goto(`${BASE_URL}/`, { waitUntil: "networkidle" });
    await waitForIdle(800);
    await page.screenshot({ path: path.join(OUTPUT_DIR, `${browser}-hero-mobile.png`), fullPage: true });
  } finally {
    await instance.close();
  }
}

async function createAdminSession() {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const response = await context.request.post(`${BASE_URL}/api/test/session`, { data: {} });
    if (!response.ok()) {
      throw new Error(`Unable to create admin session: ${response.status()} ${response.statusText()}`);
    }
    const payload = (await response.json()) as { sessionToken: string };
    const { hostname } = new URL(BASE_URL);
    await context.addCookies([
      {
        name: "next-auth.session-token",
        value: payload.sessionToken,
        domain: hostname,
        path: "/",
        httpOnly: true,
      },
    ]);
    return { browser, context };
  } catch (error) {
    await browser.close();
    throw error;
  }
}

async function captureAdminClients(contextLabel: string) {
  const { browser, context } = await createAdminSession();
  try {
    const page = await context.newPage();
    await page.goto(`${BASE_URL}/admin/clients`, { waitUntil: "networkidle" });
    await waitForIdle(800);
    await page.screenshot({ path: path.join(OUTPUT_DIR, `${contextLabel}-admin-clients.png`), fullPage: true });
    await page.goto(`${BASE_URL}/admin/members`, { waitUntil: "networkidle" });
    const removeTrigger = page.getByTestId("member-remove").first();
    await removeTrigger.click();
    await page.waitForSelector("[role='alertdialog']", { timeout: 3000 });
    await waitForIdle(300);
    await page.screenshot({ path: path.join(OUTPUT_DIR, `${contextLabel}-admin-member-modal.png`), fullPage: true });
  } finally {
    await browser.close();
  }
}

async function main() {
  await ensureOutputDir();
  await captureHeroDesktop("mockauth");
  await captureHeroMobile("mockauth");
  await captureAdminClients("mockauth");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
