import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { authenticate, createTestSession } from "./helpers/admin";

type SeededClients = { id: string; name: string; clientId: string }[];

type SeedResponse = {
  tenantAId: string;
  tenantAName: string;
  tenantBId: string;
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

    await switchTenant(page, seed.tenantBId, seed.tenantBName);
    await expectClientsVisible(page, seed.clientsB.map((client) => client.name));
    await expectClientsHidden(page, seed.clientsA.map((client) => client.name));

    const activeTenantId = await getActiveTenantId(page);
    expect(activeTenantId).toBe(seed.tenantBId);
  });
});

const seedTenantsWithClients = async (page: Page): Promise<SeedResponse> => {
  return page.evaluate<SeedResponse>(async () => {
    const response = await fetch("/admin/api/test/seed-tenants-clients", {
      method: "POST",
      credentials: "include",
    });
    if (!response.ok) {
      throw new Error(`Failed to seed tenants: ${response.status}`);
    }
    return (await response.json()) as SeedResponse;
  });
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

const getActiveTenantId = async (page: Page) => {
  return page.evaluate<string | null>(async () => {
    const response = await fetch("/admin/api/test/active-tenant", {
      credentials: "include",
    });
    if (!response.ok) {
      throw new Error(`Failed to read active tenant: ${response.status}`);
    }
    const payload = (await response.json()) as { activeTenantId: string | null };
    return payload.activeTenantId;
  });
};

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
