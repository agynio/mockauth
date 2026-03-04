import { test, expect, type Page } from "@playwright/test";

import { authenticate, createTestSession } from "./helpers/admin";

const QA_TENANT_ID = "tenant_qa";
const QA_CLIENT_NAME = "QA Client";
const QA_CLIENT_ID = "qa-client";

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
    const initialRedirect = page.url();
    const loginPattern = /\/r\/.*\/oidc\/login/;
    const redirectPattern = new RegExp(`/admin/clients/${clientId}/test/redirect`);

    await page.getByTestId("test-oauth-run-again").click();
    await page.waitForURL((url) => {
      const href = url.toString();
      if (href === initialRedirect) {
        return false;
      }
      return loginPattern.test(href) || redirectPattern.test(href);
    });

    if (loginPattern.test(page.url())) {
      const loginUrl = page.url();
      await page.getByRole("textbox", { name: /^Username/ }).fill("qa-user");
      await Promise.all([
        page.waitForURL((url) => {
          const href = url.toString();
          return redirectPattern.test(href) && href !== loginUrl;
        }),
        page.getByRole("button", { name: "Continue" }).click(),
      ]);
    }

    await expect(page.getByTestId("test-oauth-id-token")).toBeVisible({ timeout: 60000 });
    await expect(page.getByTestId("test-oauth-access-token")).toBeVisible({ timeout: 60000 });

    await expect
      .poll(async () => (await page.getByTestId("test-oauth-state").textContent())?.trim(), { timeout: 60000 })
      .not.toBe(firstState ?? null);

    const secondState = (await page.getByTestId("test-oauth-state").textContent())?.trim();
    expect(firstState).toBeTruthy();
    expect(secondState).toBeTruthy();
    expect(secondState).not.toEqual(firstState);
  });

  test("requires a new login even when a previous session exists", async ({ page }) => {
    const sessionToken = await createTestSession(page, { tenantId: QA_TENANT_ID, role: "OWNER" });
    await authenticate(page, sessionToken);

    const clientId = await openClientDetail(page, QA_TENANT_ID, QA_CLIENT_NAME);

    await completeRunAndReturnToConfigurator(page, clientId);

    const { authorizationUrl } = await startOauthTest(page, clientId, { skipOpen: true, fromConfigPage: true });
    await page.goto(authorizationUrl);
    await expect(page).toHaveURL(/\/r\/.*\/oidc\/login/);
  });

  test("ignores manual reauth query parameters on subsequent authorizations", async ({ page }) => {
    const sessionToken = await createTestSession(page, { tenantId: QA_TENANT_ID, role: "OWNER" });
    await authenticate(page, sessionToken);

    const clientId = await openClientDetail(page, QA_TENANT_ID, QA_CLIENT_NAME);

    await completeRunAndReturnToConfigurator(page, clientId);

    const { authorizationUrl } = await startOauthTest(page, clientId, { skipOpen: true, fromConfigPage: true });
    const bypassUrl = new URL(authorizationUrl);
    bypassUrl.searchParams.set("reauth", "1");
    await page.goto(bypassUrl.toString());
    await expect(page).toHaveURL(/\/r\/.*\/oidc\/login/);
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

  test("returns login_required when prompt=none", async ({ page }) => {
    const sessionToken = await createTestSession(page, { tenantId: QA_TENANT_ID, role: "OWNER" });
    await authenticate(page, sessionToken);

    const clientId = await openClientDetail(page, QA_TENANT_ID, QA_CLIENT_NAME);
    const { authorizationUrl } = await startOauthTest(page, clientId, { skipOpen: true });
    const silentUrl = new URL(authorizationUrl);
    silentUrl.searchParams.set("prompt", "none");
    await page.goto(silentUrl.toString());

    await expect(page).toHaveURL(new RegExp(`/admin/clients/${clientId}/test/redirect`));
    await expect(page.getByTestId("test-oauth-error")).toContainText("login_required");
  });

  test("reuses the previous login within the reauth TTL window", async ({ page }) => {
    const sessionToken = await createTestSession(page, { tenantId: QA_TENANT_ID, role: "OWNER" });
    await authenticate(page, sessionToken);

    const clientId = await openClientDetail(page, QA_TENANT_ID, QA_CLIENT_NAME);
    await setClientReauthTtl(page, clientId, 180);
    await completeRunAndReturnToConfigurator(page, clientId);
    const { authorizationUrl } = await startOauthTest(page, clientId, { skipOpen: true, fromConfigPage: true });
    await page.goto(authorizationUrl);
    await page.waitForURL(new RegExp(`/admin/clients/${clientId}/test/redirect`));
    await expect(page.getByTestId("test-oauth-id-token")).toBeVisible();
  });

  test("prompt=login toggle forces a credential screen even within the TTL", async ({ page }) => {
    const sessionToken = await createTestSession(page, { tenantId: QA_TENANT_ID, role: "OWNER" });
    await authenticate(page, sessionToken);

    const clientId = await openClientDetail(page, QA_TENANT_ID, QA_CLIENT_NAME);
    await setClientReauthTtl(page, clientId, 300);
    await completeRunAndReturnToConfigurator(page, clientId);
    await page.getByTestId("test-oauth-prompt-login").check();
    const { authorizationUrl } = await startOauthTest(page, clientId, { skipOpen: true, fromConfigPage: true });
    await page.goto(authorizationUrl);
    await expect(page).toHaveURL(/\/r\/.*\/oidc\/login/);
    await completeProviderLogin(page, clientId);
    await expect(page.getByTestId("test-oauth-id-token")).toBeVisible();
  });

  test("prompt=none succeeds silently when the TTL cookie is valid", async ({ page }) => {
    const sessionToken = await createTestSession(page, { tenantId: QA_TENANT_ID, role: "OWNER" });
    await authenticate(page, sessionToken);

    const clientId = await openClientDetail(page, QA_TENANT_ID, QA_CLIENT_NAME);
    await setClientReauthTtl(page, clientId, 240);
    await completeRunAndReturnToConfigurator(page, clientId);
    const { authorizationUrl } = await startOauthTest(page, clientId, { skipOpen: true, fromConfigPage: true });
    const silentUrl = new URL(authorizationUrl);
    silentUrl.searchParams.set("prompt", "none");
    await page.goto(silentUrl.toString());
    await page.waitForURL(new RegExp(`/admin/clients/${clientId}/test/redirect`));
    await expect(page.getByTestId("test-oauth-id-token")).toBeVisible();
  });

  test("fresh login handshake completes authorize once when TTL is zero", async ({ page }) => {
    const sessionToken = await createTestSession(page, { tenantId: QA_TENANT_ID, role: "OWNER" });
    await authenticate(page, sessionToken);

    const clientId = await openClientDetail(page, QA_TENANT_ID, QA_CLIENT_NAME);
    await setClientReauthTtl(page, clientId, 0);

    await startOauthTest(page, clientId);
    await expect(page.getByTestId("test-oauth-id-token")).toBeVisible();
    await expect(page.getByTestId("test-oauth-access-token")).toBeVisible();

    await page.getByRole("link", { name: "← Back to test config" }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/clients/${clientId}/test`));

    const { authorizationUrl } = await startOauthTest(page, clientId, { skipOpen: true, fromConfigPage: true });
    await page.goto(authorizationUrl);
    await expect(page).toHaveURL(/\/r\/.*\/oidc\/login/);
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

    const loginPattern = /\/r\/.*\/oidc\/login/;
    await Promise.all([
      page.waitForURL(loginPattern),
      page.getByTestId("test-oauth-run-again").click(),
    ]);
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

  test("shows tabs for multiple login strategies", async ({ page }) => {
    const sessionToken = await createTestSession(page, { tenantId: QA_TENANT_ID, role: "OWNER" });
    await authenticate(page, sessionToken);

    await updateClientAuthStrategies(page, {
      username: { enabled: true, subSource: "entered" },
      email: { enabled: true, subSource: "entered", emailVerifiedMode: "user_choice" },
    });

    try {
      const clientId = await openClientDetail(page, QA_TENANT_ID, QA_CLIENT_NAME);
      const { authorizationUrl } = await startOauthTest(page, clientId, { skipOpen: true });
      await page.goto(authorizationUrl);

      await expect(page.getByTestId("login-strategy-tabs")).toBeVisible();
      await page.getByRole("tab", { name: "Email" }).click();
      await page.getByRole("textbox", { name: /^Email/ }).fill("tab-user@example.test");
      await page.getByLabel("Unverified").click();
      await page.getByRole("button", { name: "Continue" }).click();

      await page.waitForURL(new RegExp(`/admin/clients/${clientId}/test/redirect`));
      await expect(page.getByTestId("test-oauth-decoded-id")).toContainText("tab-user@example.test");
    } finally {
      await updateClientAuthStrategies(page, {
        username: { enabled: true, subSource: "entered" },
        email: { enabled: false, subSource: "entered", emailVerifiedMode: "false" },
      });
    }
  });
});

const completeRunAndReturnToConfigurator = async (page: Page, clientId: string) => {
  await startOauthTest(page, clientId);
  await expect(page.getByTestId("test-oauth-id-token")).toBeVisible();
  await page.getByRole("link", { name: "← Back to test config" }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/clients/${clientId}/test`));
};

const setClientReauthTtl = async (page: Page, clientId: string, ttlSeconds: number) => {
  const detailPath = `/admin/clients/${clientId}`;
  const testPath = `${detailPath}/test`;
  const redirectPath = `${testPath}/redirect`;

  let path = new URL(page.url()).pathname;
  if (path === redirectPath) {
    await page.getByRole("link", { name: "← Back to test config" }).click();
    await expect(page).toHaveURL(new RegExp(`^https?://[^/]+${testPath}$`));
    path = new URL(page.url()).pathname;
  }

  if (path === testPath) {
    await page.getByRole("link", { name: "← Back to client" }).click();
    await expect(page).toHaveURL(new RegExp(`^https?://[^/]+${detailPath}$`));
  } else if (path !== detailPath) {
    await page.goto(detailPath, { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(new RegExp(`^https?://[^/]+${detailPath}$`));
  }

  const input = page.getByTestId("reauth-ttl-input");
  await expect(input).toBeVisible();
  await input.fill(ttlSeconds.toString());
  await page.getByTestId("reauth-ttl-save").click();
  await expect(input).toHaveValue(ttlSeconds.toString());
};

const openClientDetail = async (page: Page, tenantId: string, clientName: string) => {
  await page.goto("/admin/clients");
  await selectTenant(page, tenantId);
  const searchBox = page.getByRole("textbox", { name: "Search clients" });
  await expect(searchBox).toBeVisible();
  await searchBox.fill(clientName);
  const row = page.getByRole("row", { name: new RegExp(clientName, "i") }).first();
  await expect(row).toBeVisible();
  const link = row.getByRole("link", { name: "Details →" });
  await expect(link).toBeVisible();
  const href = await link.getAttribute("href");
  expect(href).toBeTruthy();
  await page.goto(href!, { waitUntil: "domcontentloaded" });
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

const updateClientAuthStrategies = async (
  page: Page,
  strategies: {
    username: { enabled: boolean; subSource: string };
    email: { enabled: boolean; subSource: string; emailVerifiedMode: string };
  },
) => {
  await page.request.post("/api/test/client-auth-strategies", {
    data: { tenantId: QA_TENANT_ID, clientId: QA_CLIENT_ID, strategies },
  });
};

type StartOptions = { expectSecretField?: boolean; skipOpen?: boolean; fromConfigPage?: boolean };

const startOauthTest = async (page: Page, clientId: string, options?: StartOptions) => {
  const expectSecretField = options?.expectSecretField ?? true;
  const skipOpen = options?.skipOpen ?? false;
  const fromConfigPage = options?.fromConfigPage ?? false;
  if (!fromConfigPage) {
    await page.getByTestId("test-oauth-link").click();
  }
  const startButton = page.getByTestId("test-oauth-start");
  await expect(startButton).toBeVisible();
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
  await startButton.click();
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

type LoginOptions = {
  strategy?: "username" | "email";
  identifier?: string;
  emailVerifiedPreference?: "true" | "false";
  previousState?: string | null;
};

const completeProviderLogin = async (page: Page, clientId: string, options?: LoginOptions) => {
  const loginPattern = /\/r\/.*\/oidc\/login/;
  const redirectPattern = new RegExp(`/admin/clients/${clientId}/test/redirect`);

  const initialUrl = page.url();

  const waitForNextNavigation = async (fromUrl: string) => {
    await page.waitForURL((url) => {
      const href = url.toString();
      if (href === fromUrl) {
        return false;
      }
      return loginPattern.test(href) || redirectPattern.test(href);
    });
  };

  let currentUrl = page.url();
  if (!loginPattern.test(currentUrl) && !redirectPattern.test(currentUrl)) {
    await waitForNextNavigation(initialUrl);
    currentUrl = page.url();
  }

  if (loginPattern.test(currentUrl)) {
    const strategy = options?.strategy ?? "username";
    await selectLoginTabIfPresent(page, strategy);
    const identifier = options?.identifier ?? (strategy === "email" ? "qa-user@example.test" : "qa-user");
    const labelPattern = strategy === "email" ? /^Email/ : /^Username/;
    await page.getByRole("textbox", { name: labelPattern }).fill(identifier);
    if (strategy === "email" && options?.emailVerifiedPreference) {
      const radioLabel = options.emailVerifiedPreference === "true" ? "Verified" : "Unverified";
      const radio = page.getByLabel(radioLabel, { exact: true });
      if (await radio.count()) {
        await radio.click();
      }
    }
    await Promise.all([
      page.waitForURL((url) => {
        const href = url.toString();
        if (href === currentUrl) {
          return false;
        }
        return redirectPattern.test(href);
      }),
      page.getByRole("button", { name: "Continue" }).click(),
    ]);
    currentUrl = page.url();
  }

  const waitForTestResult = () =>
    Promise.race([
      page.getByTestId("test-oauth-id-token").waitFor({ state: "visible", timeout: 60000 }),
      page.getByTestId("test-oauth-error").waitFor({ state: "visible", timeout: 60000 }),
    ]);

  if (!redirectPattern.test(currentUrl)) {
    await page.waitForURL((url) => redirectPattern.test(url.toString()));
    currentUrl = page.url();
  }

  await waitForTestResult();

  if (options?.previousState) {
    await expect
      .poll(async () => (await page.getByTestId("test-oauth-state").textContent())?.trim())
      .not.toBe(options.previousState);
  }
};

const selectLoginTabIfPresent = async (page: Page, strategy: "username" | "email") => {
  const tabName = strategy === "email" ? "Email" : "Username";
  const tab = page.getByRole("tab", { name: tabName });
  if ((await tab.count()) > 0) {
    await tab.click();
  }
};
