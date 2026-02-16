import type { Locator, Page } from "@playwright/test";
import { test, expect } from "@playwright/test";

const username = process.env.LOGTO_E2E_USERNAME;
const password = process.env.LOGTO_E2E_PASSWORD;

const requiresCredentials = !username || !password;

const findFirstVisible = async (locators: Locator[]) => {
  for (const locator of locators) {
    const handle = locator.first();
    if ((await handle.count()) > 0 && (await handle.isVisible())) {
      return handle;
    }
  }
  return null;
};

const fillIdentifier = async (page: Page, value: string) => {
  const field =
    (await findFirstVisible([
      page.getByLabel(/email/i),
      page.getByLabel(/username/i),
      page.getByPlaceholder(/email/i),
      page.locator('input[name="email"]'),
      page.locator('input[name="username"]'),
      page.locator('input[name="identifier"]'),
      page.locator('input[type="email"]'),
      page.locator('input[type="text"]'),
    ])) ?? undefined;

  if (!field) {
    throw new Error("Unable to locate Logto identifier field");
  }

  await field.fill(value);
};

const locatePasswordField = (page: Page) =>
  findFirstVisible([
    page.getByLabel(/password/i),
    page.getByPlaceholder(/password/i),
    page.locator('input[name="password"]'),
    page.locator('input[type="password"]'),
  ]);

const clickNamedButton = async (page: Page, labels: RegExp[], { allowMissing = false }: { allowMissing?: boolean } = {}) => {
  const button =
    (await findFirstVisible([
      ...labels.map((label) => page.getByRole("button", { name: label })),
      page.locator('button[type="submit"]'),
    ])) ?? undefined;

  if (!button) {
    if (allowMissing) {
      return false;
    }
    throw new Error(`Unable to locate Logto button matching: ${labels.map((l) => l.source).join(", ")}`);
  }

  await button.click();
  return true;
};

const advanceThroughLogto = async (page: Page) => {
  for (let attempt = 0; attempt < 4; attempt++) {
    if (!page.url().includes("logto.app")) {
      return;
    }

    const progressed = await clickNamedButton(page, [/continue/i, /allow/i, /confirm/i, /next/i], { allowMissing: true });
    if (!progressed) {
      return;
    }

    await page.waitForLoadState("networkidle");
  }
};

test.describe("admin console auth", () => {
  test.skip(requiresCredentials, "Set LOGTO_E2E_USERNAME and LOGTO_E2E_PASSWORD to run this test.");

  test("signs into the admin UI via Logto", async ({ page }) => {
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/admin\/sign-in$/);
    await page.getByRole("button", { name: /sign in with logto/i }).click();

    await page.waitForURL(/hdjvaa\.logto\.app/);

    await fillIdentifier(page, username!);

    let passwordField = await locatePasswordField(page);
    if (!passwordField) {
      await clickNamedButton(page, [/continue/i, /next/i, /sign in/i]);
      await page.waitForLoadState("networkidle");
      passwordField = await locatePasswordField(page);
    }

    if (!passwordField) {
      throw new Error("Unable to locate Logto password field");
    }

    await passwordField.fill(password!);
    await clickNamedButton(page, [/sign in/i]);
    await page.waitForLoadState("networkidle");
    await advanceThroughLogto(page);

    await page.waitForURL(/\/admin$/, { timeout: 60_000 });
    await expect(page.getByRole("heading", { name: /tenants/i })).toBeVisible();
  });
});
