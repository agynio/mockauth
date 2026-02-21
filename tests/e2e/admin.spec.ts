import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { authenticate, createTestSession, stubClipboard } from "./helpers/admin";

const tenantId = "tenant_qa";
const tenantDisplayName = "QA Sandbox";
const legacyResourceId = "tenant_qa_default_resource";
const legacyResourceName = `${tenantDisplayName} default`;
const seededClientName = "QA Client";
const emptyStateText = "No clients yet. Create one to start an OIDC flow.";

test.describe("admin console", () => {
  test("creates a client and manages redirects", async ({ page }) => {
    const sessionToken = await createTestSession(page);
    await authenticate(page, sessionToken);
    await stubClipboard(page);
    const clientName = `Playwright Client ${Date.now()}`;

    await page.goto("/admin/clients");
    await expect(page.getByRole("heading", { name: "OAuth clients" })).toBeVisible();

    const sidebar = page.getByTestId("admin-sidebar");
    await expect(sidebar.getByText("Navigation", { exact: true })).toHaveCount(1);
    await expect(sidebar.getByText("Active tenant", { exact: true })).toHaveCount(0);
    await expect(page.getByTestId("add-tenant-btn")).toHaveCount(0);

    const [tenantBox, userBox] = await Promise.all([
      page.getByTestId("tenant-switcher").boundingBox(),
      page.getByTestId("sidebar-user-badge").boundingBox(),
    ]);
    if (!tenantBox || !userBox) {
      throw new Error("Sidebar layout missing");
    }
    expect(tenantBox.y + tenantBox.height).toBeLessThanOrEqual(userBox.y);

    await page.getByTestId("tenant-switcher").click();
    await page.getByTestId("tenant-option-add").click();
    const dialog = page.getByRole("dialog", { name: "Add tenant" });
    const newTenantName = `Playwright Tenant ${Date.now()}`;
    await dialog.getByLabel("Tenant name").fill(newTenantName);
    await dialog.getByRole("button", { name: "Create tenant" }).click();
    await expect(page.getByText(`Tenant · ${newTenantName}`)).toBeVisible();
    await expect(page.getByText(emptyStateText)).toBeVisible();
    await page.reload();
    await expect(page.getByText(`Tenant · ${newTenantName}`)).toBeVisible();
    await expect(page.getByText(emptyStateText)).toBeVisible();

    await page.getByTestId("tenant-switcher").click();
    await page.getByTestId(`tenant-option-${tenantId}`).click();
    await expect.poll(async () => {
      const cookies = await page.context().cookies();
      return cookies.find((cookie) => cookie.name === "admin_active_tenant")?.value;
    }, { timeout: 10_000 }).toBe(tenantId);

    await page.getByTestId("tenant-switcher").click();
    await expect(page.getByTestId(`tenant-option-${tenantId}`)).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Escape");

    const activeTenantFromApi = await page.evaluate(async () => {
      const response = await fetch("/admin/api/test/active-tenant");
      const payload = (await response.json()) as { activeTenantId: string | null };
      return payload.activeTenantId;
    });
    expect(activeTenantFromApi).toBe(tenantId);

    await page.reload();
    await expect(page.getByText(`Tenant · ${tenantDisplayName}`)).toBeVisible();
    await expect(page.getByRole("row", { name: new RegExp(seededClientName, "i") })).toBeVisible();
    await expect(page.getByText(emptyStateText)).toHaveCount(0);

    await page.getByRole("link", { name: "Add client" }).click();
    await page.getByLabel("Client name").fill(clientName);
    await page.getByLabel("Redirect URIs").fill("https://pw.example.test/callback");
    await page.getByRole("button", { name: "Create client" }).click();
    await page.getByRole("link", { name: "Back to list" }).click();

    const row = page.getByRole("row", { name: new RegExp(clientName, "i") }).last();
    await row.getByRole("link", { name: "Details →" }).click();
    await expect(page.getByText("Redirect URIs")).toBeVisible();

    const requiredLabels = await page
      .getByTestId("oauth-required")
      .locator("[data-field-label]")
      .evaluateAll((nodes) => nodes.map((node) => node?.getAttribute("data-field-label") ?? ""));
    expect(requiredLabels).toEqual(["Tenant ID", "Client ID", "Issuer", "Authorization endpoint", "Token endpoint"]);

    const optionalLabels = await page
      .getByTestId("oauth-optional")
      .locator("[data-field-label]")
      .evaluateAll((nodes) => nodes.map((node) => node?.getAttribute("data-field-label") ?? ""));
    expect(optionalLabels).toEqual(["Discovery (.well-known)", "JWKS", "Userinfo"]);

    const tenantIdField = page.getByTestId("oauth-field-tenant-id");
    await expect(tenantIdField).toContainText("Tenant ID");
    await tenantIdField.getByRole("button", { name: "Copy Tenant ID" }).click();
    await expect(tenantIdField.getByText("Copied")).toBeVisible();

    const redirectInput = page.getByLabel("Redirect URI");
    await redirectInput.fill("*");
    await expect(page.getByTestId("redirect-any-warning")).toBeVisible();
    await redirectInput.fill("https://*.example.test/callback");
    await expect(page.getByTestId("redirect-wildcard-warning")).toBeVisible();
    await redirectInput.fill("https://pw.example.test/alt");
    await page.getByRole("button", { name: /^Add$/ }).click();
    await expect(page.getByText("https://pw.example.test/alt")).toBeVisible();

    await page.getByRole("button", { name: "Rotate secret" }).click();
    await expect(page.getByText("New client secret")).toBeVisible();

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
    await searchInput.fill(clientName);
    await expect.poll(() => new URL(page.url()).searchParams.get("q")).toBe(clientName);
    await expect(page.getByRole("row", { name: new RegExp(clientName, "i") })).toBeVisible();

    await searchInput.fill("Totally Missing");
    await expect(page).toHaveURL(/q=Totally%20Missing/);
    await expect(page.getByText(/No clients match/i)).toBeVisible();

    await searchInput.fill("");
    await expect(page).toHaveURL(/\/admin\/clients$/);

    const paginationClients = Array.from({ length: 12 }, (_, index) => `Pagination Client ${index + 1}`);
    await page.request.post("/api/test/clients", {
      data: { tenantId, names: paginationClients },
    });
    await page.reload();
    await expect(page.getByRole("heading", { name: "OAuth clients" })).toBeVisible();

    await page.getByRole("link", { name: "Next →" }).click();
    await expect(page).toHaveURL(/page=2/);

    await searchInput.fill("Pagination Client 11");
    await expect(page).toHaveURL(/q=Pagination%20Client%2011/);
    await expect(page).not.toHaveURL(/page=/);
    await expect(page.getByRole("row", { name: /Pagination Client 11/ })).toBeVisible();

    await searchInput.fill("");
    await expect(page).toHaveURL(/\/admin\/clients$/);
    await page.getByRole("link", { name: "Next →" }).click();
    await expect(page).toHaveURL(/page=2/);

    await page.getByTestId("logout-button").click();
    await page.waitForURL("**/api/auth/signin**");
  });

  test("manages API resources and client issuers", async ({ page }) => {
    const seed = await seedTenantsWithClients(page);
    const tenantIdUnderTest = seed.tenantAId;
    const tenantNameUnderTest = seed.tenantAName;
    const legacyResourceId = seed.tenantAResourceId;
    const legacyResourceName = `${tenantNameUnderTest} default`;
    const seededClientName = seed.clientsA[0]?.name ?? "Tenant A Client";

    const sessionToken = await createTestSession(page, { tenantId: tenantIdUnderTest });
    await authenticate(page, sessionToken);

    const createResource = async () => {
      const resourceName = `Playwright API ${Date.now()}`;
      await page.goto("/admin/api-resources");
      await selectTenant(page, tenantIdUnderTest);
      await expect(page.getByRole("heading", { name: "API resources" })).toBeVisible();
      await page.getByTestId("api-resource-create-btn").click();
      const dialog = page.getByRole("dialog", { name: "Create API resource" });
      await dialog.getByLabel("Display name").fill(resourceName);
      await dialog.getByLabel("Description").fill("Playwright resource");
      await dialog.getByRole("button", { name: "Create" }).click();
      const row = page.getByRole("row", { name: new RegExp(escapeRegExp(resourceName), "i") }).last();
      await expect(row.getByText(resourceName)).toBeVisible();
      const resourceId = await row.getAttribute("data-resource-id");
      expect(resourceId).toBeTruthy();
      return { row, resourceName, resourceId: resourceId! };
    };

    const { row, resourceName, resourceId } = await createResource();
    await row.getByRole("button", { name: "Set default" }).click();
    await expect(row.getByTestId("api-resource-default-badge")).toBeVisible();

    const issuerPanel = page.getByTestId("issuer-panel");
    await expect(issuerPanel).toContainText(resourceName);
    await expect(page.getByTestId("issuer-field-issuer")).toContainText(`/r/${resourceId}/oidc`);

    await page.goto("/admin/clients");
    await selectTenant(page, tenantIdUnderTest);
    await page.getByRole("row", { name: new RegExp(escapeRegExp(seededClientName), "i") })
      .last()
      .getByRole("link", { name: "Details →" })
      .click();
    await expect(page.getByText(new RegExp(`Currently issuing for ${escapeRegExp(resourceName)}`))).toBeVisible();
    const issuerSelect = page.getByRole("combobox", { name: "API resource" });
    await expect(issuerSelect).toHaveText(new RegExp(`Tenant default \\(${escapeRegExp(resourceName)}\\)`));

    await issuerSelect.click();
    const legacyOption = page.getByTestId(`issuer-option-${legacyResourceId}`);
    await expect(legacyOption).toBeVisible();
    await expect(legacyOption).toHaveText(new RegExp(escapeRegExp(legacyResourceName)));
    await legacyOption.click();
    await expect(issuerSelect).toHaveText(new RegExp(escapeRegExp(legacyResourceName)));
    await page.getByTestId("issuer-form-save").click();
    await expect(page.getByText(new RegExp(`Currently issuing for ${escapeRegExp(legacyResourceName)}`))).toBeVisible();
    const issuerSelectAfterSave = page.getByRole("combobox", { name: "API resource" });
    await expect(issuerSelectAfterSave).toHaveText(new RegExp(escapeRegExp(legacyResourceName)));
    await expect(page.getByTestId("oauth-field-issuer")).toContainText(`/r/${legacyResourceId}/oidc`);
    await expect(page.getByTestId("oauth-field-discovery")).toContainText(`/r/${legacyResourceId}/oidc/.well-known`);

    await page.reload();
    await selectTenant(page, tenantIdUnderTest);
    const issuerSelectAfterReload = page.getByRole("combobox", { name: "API resource" });
    await expect(issuerSelectAfterReload).toHaveText(new RegExp(escapeRegExp(legacyResourceName)));
    await expect(page.getByTestId("oauth-field-issuer")).toContainText(`/r/${legacyResourceId}/oidc`);
    await expect(page.getByTestId("oauth-field-discovery")).toContainText(`/r/${legacyResourceId}/oidc/.well-known`);

    await page.goto("/admin/api-resources");
    await selectTenant(page, tenantIdUnderTest);
    const originalRow = page.getByRole("row", { name: new RegExp(escapeRegExp(legacyResourceName), "i") });
    await originalRow.getByRole("button", { name: "Set default" }).click();
    await expect(originalRow.getByTestId("api-resource-default-badge")).toBeVisible();
  });
});

type SeedResponse = {
  tenantAId: string;
  tenantAResourceId: string;
  tenantAName: string;
  clientsA: { name: string }[];
};

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const seedTenantsWithClients = async (page: Page): Promise<SeedResponse> => {
  const response = await page.request.post("/admin/api/test/seed-tenants-clients", { data: {} });
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as SeedResponse;
};

const selectTenant = async (page: Page, tenantId: string) => {
  const switcher = page.getByTestId("tenant-switcher");
  await switcher.click();
  const option = page.getByTestId(`tenant-option-${tenantId}`);
  await expect(option).toBeVisible();
  await option.click();
};
