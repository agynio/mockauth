import { test, expect, type Page } from "@playwright/test";

import { authenticate, createTestSession } from "./helpers/admin";

const QA_TENANT_ID = "tenant_qa";
const QA_CLIENT_NAME = "QA Client";

test.describe("Client Test OAuth", () => {
  test("runs the guided OAuth test flow", async ({ page }) => {
    const sessionToken = await createTestSession(page, { tenantId: QA_TENANT_ID, role: "OWNER" });
    await authenticate(page, sessionToken);

    const clientId = await openClientDetail(page, QA_TENANT_ID, QA_CLIENT_NAME);

    await page.getByTestId("test-oauth-link").click();
    const warning = page.getByTestId("test-oauth-warning");
    await expect(warning).toBeVisible();
    await page.getByTestId("test-oauth-add-redirect").click();
    await expect(warning).toHaveCount(0);

    await page.getByTestId("test-oauth-secret").fill("qa-secret");
    await page.getByTestId("test-oauth-start").click();

    await page.waitForURL(/\/r\/.*\/oidc\/login/);
    await page.getByRole("textbox", { name: /^Username/ }).fill("qa-user");
    await page.getByRole("button", { name: "Continue" }).click();

    await page.waitForURL(new RegExp(`/admin/clients/${clientId}/test/redirect`));
    await expect(page.getByTestId("test-oauth-id-token")).toBeVisible();
    await expect(page.getByTestId("test-oauth-access-token")).toBeVisible();
    await expect(page.getByTestId("test-oauth-decoded-id")).toContainText("\"sub\"");
  });

  test("surfaces authorization errors on the redirect page", async ({ page }) => {
    const sessionToken = await createTestSession(page, { tenantId: QA_TENANT_ID, role: "OWNER" });
    await authenticate(page, sessionToken);

    const clientId = await openClientDetail(page, QA_TENANT_ID, QA_CLIENT_NAME);

    await page.goto(
      `/admin/clients/${clientId}/test/redirect?error=access_denied&error_description=Denied&state=manual`,
    );

    await expect(page.getByTestId("test-oauth-error")).toContainText("access_denied: Denied");
  });
});

const openClientDetail = async (page: Page, tenantId: string, clientName: string) => {
  await page.goto("/admin/clients");
  await selectTenant(page, tenantId);
  const row = page.getByRole("row", { name: new RegExp(clientName, "i") }).first();
  await row.getByRole("link", { name: "Details →" }).click();
  await expect(page).toHaveURL(/\/admin\/clients\//);
  const currentUrl = new URL(page.url());
  const segments = currentUrl.pathname.split("/");
  return segments[segments.length - 1];
};

const selectTenant = async (page: Page, tenantId: string) => {
  const switcher = page.getByTestId("tenant-switcher");
  await switcher.click();
  const option = page.getByTestId(`tenant-option-${tenantId}`);
  await expect(option).toBeVisible();
  await option.click();
};
