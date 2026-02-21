import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { authenticate, createTestSession, stubClipboard } from "./helpers/admin";

type SeededClients = { id: string; name: string; clientId: string }[];

type SeedResponse = {
  tenantAId: string;
  tenantAResourceId: string;
  tenantAName: string;
  tenantBId: string;
  tenantBResourceId: string;
  tenantBName: string;
  clientsA: SeededClients;
  clientsB: SeededClients;
};

test.describe("tenant switching", () => {
  test("client lists differ per tenant", async ({ page }) => {
    await page.goto("/");
    const seed = await seedTenantsWithClients(page);

    const sessionToken = await createTestSession(page);
    await authenticate(page, sessionToken);

    await page.goto("/admin/clients");
    await expect(page.getByRole("heading", { name: "OAuth clients" })).toBeVisible();

    await switchTenant(page, seed.tenantAId, seed.tenantAName);
    await expectClientsVisible(page, seed.clientsA.map((client) => client.name));
    await expectClientsHidden(page, seed.clientsB.map((client) => client.name));
    await expectTenantCookie(page, seed.tenantAId);
    await expectActiveTenant(page, seed.tenantAId);

    await switchTenant(page, seed.tenantBId, seed.tenantBName);
    await expectClientsVisible(page, seed.clientsB.map((client) => client.name));
    await expectClientsHidden(page, seed.clientsA.map((client) => client.name));
    await expectTenantCookie(page, seed.tenantBId);
    await expectActiveTenant(page, seed.tenantBId);
  });

  test("guardrail: add tenant action lives inside switcher", async ({ page }) => {
    const sessionToken = await createTestSession(page);
    await authenticate(page, sessionToken);

    await page.goto("/admin");
    await expect(page.locator('[data-testid="tenant-option-add"]')).toHaveCount(0);

    await page.getByTestId("tenant-switcher").click();
    const addButton = page.getByTestId("tenant-option-add");
    await expect(addButton).toBeVisible();
    await addButton.click();

    const dialog = page.getByRole("dialog", { name: "Add tenant" });
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
  });

  test("tenants page opens and deletes tenants", async ({ page }) => {
    await page.goto("/");
    const adminEmail = `pw-tenants-${Date.now()}@example.test`;
    const seed = await seedTenantsWithClients(page, { adminEmail });
    const sessionToken = await createTestSession(page, {
      assignMembership: false,
      email: adminEmail,
      tenantId: seed.tenantAId,
    });
    await authenticate(page, sessionToken);
    await stubClipboard(page);

    await page.goto("/admin/tenants");
    const table = page.getByTestId("tenants-table");
    await expect(table.getByTestId(`tenant-row-${seed.tenantAId}`)).toBeVisible();
    await expect(table.getByTestId(`tenant-row-${seed.tenantBId}`)).toBeVisible();

    await page.getByTestId(`tenant-copy-${seed.tenantAId}`).click();
    await expect.poll(async () => {
      return page.evaluate(() => (window as typeof window & { __mockClipboard?: string }).__mockClipboard ?? null);
    }).toBe(seed.tenantAId);

    await page.getByTestId(`tenant-open-${seed.tenantBId}`).click();
    const notifications = page.getByRole("region", { name: /Notifications/i });
    await expect(notifications.getByRole("status").first()).toContainText("Tenant switched");
    await expectActiveTenant(page, seed.tenantBId);

    await page.getByTestId(`tenant-delete-${seed.tenantBId}`).click();
    const confirmDialog = page.getByRole("alertdialog", { name: new RegExp(`Delete ${escapeRegExp(seed.tenantBName)}`) });
    await expect(confirmDialog).toBeVisible();
    await confirmDialog.getByTestId("tenant-delete-confirm").click();

    await expect(page.getByRole("status").first()).toContainText("Tenant deleted");
    await expect(table.getByTestId(`tenant-row-${seed.tenantBId}`)).toHaveCount(0);
    await expectActiveTenant(page, seed.tenantAId);
    await expectTenantCookie(page, seed.tenantAId);

    const state = await page.evaluate(async (tenantId) => {
      const response = await fetch("/admin/api/test/tenant-state", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tenantId }),
      });
      if (!response.ok) {
        throw new Error(`Failed to read tenant state: ${response.status}`);
      }
      return (await response.json()) as {
        tenantExists: boolean;
        counts: Record<string, number>;
      };
    }, seed.tenantBId);

    expect(state.tenantExists).toBe(false);
    Object.values(state.counts).forEach((value) => expect(value).toBe(0));
  });
});

const seedTenantsWithClients = async (page: Page, options: { adminEmail?: string } = {}): Promise<SeedResponse> => {
  return page.evaluate<SeedResponse, { adminEmail?: string }>(async (payload) => {
    const response = await fetch("/admin/api/test/seed-tenants-clients", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload ?? {}),
    });
    if (!response.ok) {
      throw new Error(`Failed to seed tenants: ${response.status}`);
    }
    return (await response.json()) as SeedResponse;
  }, options);
};

const switchTenant = async (page: Page, tenantId: string, tenantName: string) => {
  await page.getByTestId("tenant-switcher").click();
  const option = page.getByTestId(`tenant-option-${tenantId}`);
  await expect(option).toBeVisible();
  await option.click();
  const notifications = page.getByRole("region", { name: /Notifications/i });
  await expect(notifications.getByRole("status").first()).toContainText("Active tenant updated");
  await expect(page.getByText(`Tenant · ${tenantName}`)).toBeVisible();
};

const expectClientsVisible = async (page: Page, clientNames: string[]) => {
  for (const name of clientNames) {
    const matcher = new RegExp(escapeRegExp(name), "i");
    await expect(page.getByRole("row", { name: matcher })).toBeVisible();
  }
};

const expectClientsHidden = async (page: Page, clientNames: string[]) => {
  for (const name of clientNames) {
    const matcher = new RegExp(escapeRegExp(name), "i");
    await expect(page.getByRole("row", { name: matcher })).toHaveCount(0);
  }
};

const expectActiveTenant = async (page: Page, tenantId: string) => {
  const activeTenantId = await page.evaluate<string | null>(async () => {
    const response = await fetch("/admin/api/test/active-tenant", {
      credentials: "include",
    });
    if (!response.ok) {
      throw new Error(`Failed to read active tenant: ${response.status}`);
    }
    const payload = (await response.json()) as { activeTenantId: string | null };
    return payload.activeTenantId;
  });
  expect(activeTenantId).toBe(tenantId);
};

const expectTenantCookie = async (page: Page, tenantId: string) => {
  await expect.poll(async () => {
    const cookies = await page.context().cookies();
    return cookies.find((cookie) => cookie.name === "admin_active_tenant")?.value ?? null;
  }, { timeout: 10_000 }).toBe(tenantId);
};

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
