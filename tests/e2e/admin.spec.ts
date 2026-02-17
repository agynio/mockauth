import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

const tenantId = "tenant_qa";

test.describe("admin console", () => {
  test("creates a client and manages redirects", async ({ page }) => {
    const sessionToken = await createTestSession(page);
    await authenticate(page, sessionToken);

    await page.goto("/admin/clients");
    await expect(page.getByRole("heading", { name: "QA Sandbox" })).toBeVisible();

    await page.getByRole("link", { name: "Add client" }).click();
    await page.getByPlaceholder("Demo SPA").fill("Playwright Client");
    await page.getByPlaceholder("https://client.example.test/callback").fill("https://pw.example.test/callback");
    await page.getByRole("button", { name: "Create client" }).click();
    await expect(page.getByText("Client created")).toBeVisible();

    await page.goto("/admin/clients");
    const card = page.locator("li", { hasText: "Playwright Client" }).first();
    await card.getByRole("link", { name: "View details" }).click();
    await expect(page.getByText("Redirect URIs")).toBeVisible();
    const redirectForm = page.locator("form", {
      has: page.getByPlaceholder("https://app.example.com/callback"),
    });
    await redirectForm.getByPlaceholder("https://app.example.com/callback").fill("https://pw.example.test/alt");
    await redirectForm.getByRole("button", { name: "Add" }).click();
    await expect(page.getByText("Redirect URI saved")).toBeVisible();
    await expect(page.getByText("https://pw.example.test/alt")).toBeVisible();
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
