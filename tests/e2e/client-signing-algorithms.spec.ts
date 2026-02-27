import { expect, test, type Page } from "@playwright/test";

import { authenticate, createTestSession } from "./helpers/admin";

test.describe("client signing algorithms", () => {
  test("admin updates ID and access token algorithms", async ({ page }) => {
    const seed = await seedTenantClient(page);
    const sessionToken = await createTestSession(page, { tenantId: seed.tenantId });
    await authenticate(page, sessionToken);
    await setActiveTenantCookie(page, seed.tenantId);

    await page.goto("/admin/clients");
    await expect(page.getByRole("heading", { name: "OAuth clients" })).toBeVisible();
    await selectTenant(page, seed.tenantId);
    await expect(page.getByRole("row", { name: new RegExp(seed.clientName, "i") })).toBeVisible();

    await page.goto(`/admin/clients/${seed.clientInternalId}`);
    await expect(page.getByRole("heading", { name: "Signing algorithms" })).toBeVisible();

    const idTrigger = page.getByTestId("signing-id-token-alg-trigger");
    await expect(idTrigger).toBeVisible();
    await idTrigger.click();
    await page.getByTestId("signing-id-token-alg-option-RS256").click();
    await expect(idTrigger).toContainText("RS256 (RSA SHA-256)");

    const accessTrigger = page.getByTestId("signing-access-token-alg-trigger");
    const summary = page.getByText(/Access tokens will use/);
    await accessTrigger.click();
    await page.getByTestId("signing-access-token-alg-option-match_id").click();
    await expect(summary).toContainText("RS256");

    await accessTrigger.click();
    await page.getByTestId("signing-access-token-alg-option-PS256").click();
    await expect(accessTrigger).toContainText("PS256 (RSA-PSS SHA-256)");
    await expect(summary).toContainText("PS256");

    const saveButton = page.getByTestId("signing-algs-save");
    await expect(saveButton).toBeEnabled();
    await saveButton.click();
    await expect(page.getByText("Signing algorithms updated", { exact: true }).first()).toBeVisible();

    await page.reload();
    await expect(page.getByTestId("signing-id-token-alg-trigger")).toContainText("RS256 (RSA SHA-256)");
    await expect(page.getByTestId("signing-access-token-alg-trigger")).toContainText("PS256 (RSA-PSS SHA-256)");
    await expect(summary).toContainText("PS256");
  });
});

const seedTenantClient = async (page: Page) => {
  const response = await page.request.post("/admin/api/test/seed-tenants-clients", { data: {} });
  expect(response.ok()).toBeTruthy();
  const payload = (await response.json()) as {
    tenantAId: string;
    clientsA: { id: string; clientId: string; name: string }[];
  };
  const client = payload.clientsA[0];
  if (!client) {
    throw new Error("missing_seeded_client");
  }
  return {
    tenantId: payload.tenantAId,
    clientInternalId: client.id,
    clientId: client.clientId,
    clientName: client.name,
  };
};

const setActiveTenantCookie = async (page: Page, tenantId: string) => {
  await page.context().addCookies([
    {
      name: "admin_active_tenant",
      value: tenantId,
      domain: "127.0.0.1",
      path: "/admin",
      httpOnly: true,
      sameSite: "Lax",
      secure: false,
      expires: Math.floor(Date.now() / 1000) + 60 * 60,
    },
  ]);
};

const selectTenant = async (page: Page, tenantId: string) => {
  const switcher = page.getByTestId("tenant-switcher");
  await switcher.click();
  const option = page.getByTestId(`tenant-option-${tenantId}`);
  await option.click();
  await expect(page.getByTestId("tenant-switcher-id")).toHaveText(tenantId.slice(0, 8));
};
