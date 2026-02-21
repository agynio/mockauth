import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { authenticate, createTestSession } from "./helpers/admin";

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

  test("overview danger zone deletes tenants", async ({ page }) => {
    await page.goto("/");
    const adminEmail = `pw-tenants-${Date.now()}@example.test`;
    const seed = await seedTenantsWithClients(page, { adminEmail });
    const sessionToken = await createTestSession(page, {
      assignMembership: false,
      email: adminEmail,
      tenantId: seed.tenantAId,
    });
    await authenticate(page, sessionToken);

    await page.goto("/admin/clients");
    await switchTenant(page, seed.tenantBId, seed.tenantBName);

    await page.goto("/admin");
    const dangerZone = page.getByTestId("tenant-danger-zone");
    await expect(dangerZone).toBeVisible();
    const deleteButton = page.getByTestId("tenant-danger-delete");
    await expect(deleteButton).toBeEnabled();
    await deleteButton.click();

    const confirmDialog = page.getByRole("alertdialog", { name: new RegExp(`Delete ${escapeRegExp(seed.tenantBName)}`) });
    await expect(confirmDialog).toBeVisible();
    await confirmDialog.getByTestId("tenant-danger-confirm").click();

    const notifications = page.getByRole("region", { name: /Notifications/i });
    await expect(notifications.getByRole("status").first()).toContainText("Tenant deleted");
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
  const truncatedId = tenantId.slice(0, 8);
  await expect(page.locator('[data-testid="tenant-switcher-id"]:visible')).toHaveText(truncatedId);
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
