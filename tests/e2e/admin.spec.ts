import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

const tenantId = "tenant_qa";

test.describe("admin console", () => {
  test("creates a client and manages redirects", async ({ page }) => {
    const sessionToken = await createTestSession(page);
    await authenticate(page, sessionToken);
    await stubClipboard(page);

    await page.goto("/admin/clients");
    await expect(page.getByRole("heading", { name: "OAuth clients" })).toBeVisible();

    const newTenantName = `Playwright Tenant ${Date.now()}`;
    await page.getByTestId("tenant-switcher").click();
    await page.getByTestId("tenant-option-add").click();
    const dialog = page.getByRole("dialog", { name: "Add tenant" });
    await dialog.getByLabel("Tenant name").fill(newTenantName);
    await dialog.getByRole("button", { name: "Create tenant" }).click();
    const notifications = page.getByRole("region", { name: /Notifications/i });
    await expect(notifications.getByRole("status").first()).toContainText("Tenant created");
    await page.reload();
    await expect(page.getByText(`Tenant · ${newTenantName}`)).toBeVisible();

    await page.getByTestId("tenant-switcher").click();
    await page.getByRole("option", { name: /QA Sandbox/i }).click();
    await expect(page.getByRole("region", { name: /Notifications/i }).getByRole("status").first()).toContainText("Active tenant updated");
    await expect.poll(async () => {
      const cookies = await page.context().cookies();
      return cookies.find((cookie) => cookie.name === "admin_active_tenant")?.value;
    }, { timeout: 10_000 }).toBe(tenantId);
    await page.getByTestId("tenant-switcher").click();
    await expect(page.getByTestId("tenant-option-tenant_qa")).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Escape");

    await page.getByRole("link", { name: "Add client" }).click();
    await page.getByLabel("Client name").fill("Playwright Client");
    await page.getByLabel("Redirect URIs").fill("https://pw.example.test/callback");
    await page.getByRole("button", { name: "Create client" }).click();
    await expect(page.getByRole("region", { name: /Notifications/i }).getByRole("status").first()).toContainText("Client created");
    await page.getByRole("link", { name: "Back to list" }).click();

    const row = page.getByRole("row", { name: /Playwright Client/ }).last();
    await row.getByRole("link", { name: "Details →" }).click();
    await expect(page.getByText("Redirect URIs")).toBeVisible();

    await page.getByLabel("Redirect URI").fill("https://pw.example.test/alt");
    await page.getByRole("button", { name: /^Add$/ }).click();
    await expect(page.getByRole("region", { name: /Notifications/i }).getByRole("status").first()).toContainText("Redirect saved");
    await expect(page.getByText("https://pw.example.test/alt")).toBeVisible();

    await page.getByRole("button", { name: "Rotate secret" }).click();
    await expect(page.getByText(/^Client secret rotated$/)).toBeVisible();
    await expect(page.getByText(/^New client secret$/)).toBeVisible();

    const requiredSection = page.getByTestId("oauth-required");
    await expect(requiredSection.getByText(/^Required$/)).toBeVisible();
    await expect(requiredSection.getByText(/^Client ID$/)).toBeVisible();
    const optionalSection = page.getByTestId("oauth-optional");
    await expect(optionalSection.getByText(/^JWKS$/)).toBeVisible();

    const copyRequiredButton = page.getByTestId("oauth-copy-required-btn");
    await copyRequiredButton.click();
    await expect(copyRequiredButton).toHaveText("Copied");

    const redirectRow = page.getByRole("row", { name: /https:\/\/pw\.example\.test\/alt/ });
    await redirectRow.getByRole("button", { name: "Remove" }).click();
    await expect(redirectRow).toHaveCount(0);

    await page.getByRole("link", { name: "← Back to clients" }).click();
    const searchInput = page.getByTestId("clients-search-input");
    await searchInput.fill("Playwright Client");
    await expect(page).toHaveURL(/q=Playwright%20Client/);
    await expect(page.getByRole("row", { name: /Playwright Client/ })).toBeVisible();

    await searchInput.fill("Totally Missing");
    await expect(page).toHaveURL(/q=Totally%20Missing/);
    await expect(page.getByText(/No clients match/i)).toBeVisible();

    await searchInput.fill("");
    await expect(page).toHaveURL(/\/admin\/clients$/);

    await page.getByTestId("logout-button").click();
    await page.waitForURL("**/api/auth/signin**");
  });
});

const createTestSession = async (page: Page) => {
  const response = await page.request.post("/api/test/session", {
    data: { tenantId },
  });
  if (!response.ok()) {
    throw new Error(`Failed to create test session: ${response.status()}`);
  }
  const body = await response.json();
  return body.sessionToken as string;
};

const authenticate = async (page: Page, sessionToken: string) => {
  await page.context().addCookies([
    {
      name: "next-auth.session-token",
      value: sessionToken,
      domain: "127.0.0.1",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
      secure: false,
      expires: Math.floor(Date.now() / 1000) + 4 * 60 * 60,
    },
  ]);
};

const stubClipboard = async (page: Page) => {
  await page.addInitScript(() => {
    const writeText = () => Promise.resolve();
    const stub = { writeText };
    if (navigator.clipboard) {
      navigator.clipboard.writeText = writeText;
      return;
    }
    Object.defineProperty(navigator, "clipboard", {
      value: stub,
      configurable: true,
    });
  });
};
