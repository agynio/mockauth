import { test, expect, type Page } from "@playwright/test";

import { authenticate, createTestSession } from "./helpers/admin";

const QA_TENANT_ID = "tenant_qa";
const QA_CLIENT_NAME = "QA Client";

test.describe("Client Test OAuth", () => {
  test("runs the guided OAuth test flow", async ({ page }) => {
    const sessionToken = await createTestSession(page, { tenantId: QA_TENANT_ID, role: "OWNER" });
    await authenticate(page, sessionToken);

    const clientId = await openClientDetail(page, QA_TENANT_ID, QA_CLIENT_NAME);

    await startOauthTest(page, clientId);
    await expect(page.getByTestId("test-oauth-id-token")).toBeVisible();
    await expect(page.getByTestId("test-oauth-access-token")).toBeVisible();
    await expect(page.getByTestId("test-oauth-decoded-id")).toContainText("\"sub\"");

    const firstState = (await page.getByTestId("test-oauth-state").textContent())?.trim();
    await page.getByTestId("test-oauth-run-again").click();
    await completeProviderLogin(page, clientId);

    const secondState = (await page.getByTestId("test-oauth-state").textContent())?.trim();
    await expect(page.getByTestId("test-oauth-id-token")).toBeVisible();
    await expect(page.getByTestId("test-oauth-access-token")).toBeVisible();
    expect(firstState).toBeTruthy();
    expect(secondState).toBeTruthy();
    expect(secondState).not.toEqual(firstState);
  });

  test("runs two Test OAuth sessions back-to-back from the configurator", async ({ page }) => {
    const sessionToken = await createTestSession(page, { tenantId: QA_TENANT_ID, role: "OWNER" });
    await authenticate(page, sessionToken);

    const clientId = await openClientDetail(page, QA_TENANT_ID, QA_CLIENT_NAME);

    await startOauthTest(page, clientId);
    const firstState = (await page.getByTestId("test-oauth-state").textContent())?.trim();
    await expect(page.getByTestId("test-oauth-id-token")).toBeVisible();

    await page.getByRole("link", { name: "← Back to test config" }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/clients/${clientId}/test`));

    await startOauthTest(page, clientId, { fromConfigPage: true });
    const secondState = (await page.getByTestId("test-oauth-state").textContent())?.trim();
    await expect(page.getByTestId("test-oauth-id-token")).toBeVisible();
    expect(firstState).toBeTruthy();
    expect(secondState).toBeTruthy();
    expect(secondState).not.toEqual(firstState);
  });

  test("shows the multiline authorization URL with Copy and Open controls", async ({ page }) => {
    const sessionToken = await createTestSession(page, { tenantId: QA_TENANT_ID, role: "OWNER" });
    await authenticate(page, sessionToken);

    const clientId = await openClientDetail(page, QA_TENANT_ID, QA_CLIENT_NAME);
    const { authorizationUrl } = await startOauthTest(page, clientId, { skipOpen: true });

    const textarea = page.getByTestId("test-oauth-authorization-textarea");
    await expect(textarea).toHaveAttribute("readonly", "");
    await expect(textarea).toHaveValue(authorizationUrl);

    const origin = new URL(page.url()).origin;
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin });
    await page.getByTestId("test-oauth-authorization-copy").click();
    const clipboardContents = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboardContents).toBe(authorizationUrl);

    const loginNavigation = page.waitForURL(/\/r\/.*\/oidc\/login/);
    await page.getByTestId("test-oauth-authorization-open").click();
    await loginNavigation;
    await completeProviderLogin(page, clientId);
    await expect(page.getByTestId("test-oauth-id-token")).toBeVisible();
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

  test("prompts to rerun when the session is expired", async ({ page }) => {
    const sessionToken = await createTestSession(page, { tenantId: QA_TENANT_ID, role: "OWNER" });
    await authenticate(page, sessionToken);

    const clientId = await openClientDetail(page, QA_TENANT_ID, QA_CLIENT_NAME);

    await startOauthTest(page, clientId);
    await expect(page.getByTestId("test-oauth-id-token")).toBeVisible();
    const expiredUrl = page.url();

    await page.goto(`/admin/clients/${clientId}/test`);
    await page.goto(expiredUrl);

    const errorAlert = page.getByTestId("test-oauth-error");
    await expect(errorAlert).toContainText("Test session expired or already used.");
    await expect(errorAlert).toContainText("Run again");
    await expect(page.getByTestId("test-oauth-reset")).toBeVisible();

    await page.getByTestId("test-oauth-run-again").click();
    await completeProviderLogin(page, clientId);

    await expect(page.getByTestId("test-oauth-id-token")).toBeVisible();
  });

  test("hides the client secret input for public clients", async ({ page }) => {
    const sessionToken = await createTestSession(page, { tenantId: QA_TENANT_ID, role: "OWNER" });
    await authenticate(page, sessionToken);

    const publicName = `Public Client ${Date.now()}`;
    const response = await page.request.post("/api/test/clients", {
      data: { tenantId: QA_TENANT_ID, names: [publicName], clientType: "PUBLIC" },
    });
    const payload = (await response.json()) as { clients?: { id: string }[] };
    if (!payload.clients?.[0]?.id) {
      throw new Error("Failed to seed public client");
    }

    const clientId = await openClientDetail(page, QA_TENANT_ID, publicName);
    await startOauthTest(page, clientId, { expectSecretField: false });
    await expect(page.getByTestId("test-oauth-id-token")).toBeVisible();
    await expect(page.getByTestId("test-oauth-access-token")).toBeVisible();
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

type StartOptions = { expectSecretField?: boolean; skipOpen?: boolean; fromConfigPage?: boolean };

const startOauthTest = async (page: Page, clientId: string, options?: StartOptions) => {
  const expectSecretField = options?.expectSecretField ?? true;
  const skipOpen = options?.skipOpen ?? false;
  const fromConfigPage = options?.fromConfigPage ?? false;
  if (!fromConfigPage) {
    await page.getByTestId("test-oauth-link").click();
  }
  await addTestRedirectIfNeeded(page);
  const secretInput = page.getByTestId("test-oauth-secret-input");
  if (expectSecretField) {
    await expect(secretInput).toBeVisible();
    const currentSecret = (await secretInput.inputValue()).trim();
    expect(currentSecret.length).toBeGreaterThan(0);
    await secretInput.fill(`${currentSecret} `);
    await secretInput.fill(currentSecret);
  } else {
    await expect(secretInput).toHaveCount(0);
  }
  await page.getByTestId("test-oauth-start").click();
  const textarea = page.getByTestId("test-oauth-authorization-textarea");
  await expect(textarea).toBeVisible();
  const authorizationUrl = (await textarea.inputValue()).trim();
  if (!skipOpen) {
    await page.getByTestId("test-oauth-authorization-open").click();
    await completeProviderLogin(page, clientId);
  }
  return { authorizationUrl };
};

const addTestRedirectIfNeeded = async (page: Page) => {
  const warning = page.getByTestId("test-oauth-warning");
  if ((await warning.count()) === 0) {
    return;
  }
  await expect(warning).toBeVisible();
  await page.getByTestId("test-oauth-add-redirect").click();
  await expect(warning).toHaveCount(0);
};

const completeProviderLogin = async (page: Page, clientId: string) => {
  await page.waitForURL(/\/r\/.*\/oidc\/login/);
  await page.getByRole("textbox", { name: /^Username/ }).fill("qa-user");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.waitForURL(new RegExp(`/admin/clients/${clientId}/test/redirect`));
};
