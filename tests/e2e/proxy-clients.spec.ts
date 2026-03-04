import { expect, test } from "@playwright/test";

import { authenticate, createTestSession, stubClipboard } from "./helpers/admin";

test.describe("proxy clients", () => {
  test("creates a proxy client and updates provider config", async ({ page }) => {
    const sessionToken = await createTestSession(page);
    await authenticate(page, sessionToken);
    await stubClipboard(page);

    await page.goto("/admin/clients");
    await expect(page.getByRole("heading", { name: "OAuth clients" })).toBeVisible();

    const clientName = `Proxy Client ${Date.now()}`;

    await page.getByRole("link", { name: "Add client" }).click();
    await expect(page.getByRole("heading", { name: "New client" })).toBeVisible();

    await page.getByLabel("Client name").fill(clientName);
    await page.getByRole("tab", { name: "Proxy" }).click();

    await page.getByLabel("Provider client ID").fill("proxy-upstream-client");
    await page.getByLabel("Provider client secret").fill("proxy-upstream-secret");
    await page.getByLabel("Authorization endpoint").fill("https://upstream.example.test/oauth2/authorize");
    await page.getByLabel("Token endpoint").fill("https://upstream.example.test/oauth2/token");
    await page.getByLabel("Userinfo endpoint").fill("https://upstream.example.test/oauth2/userinfo");
    await page.getByLabel("JWKS URI").fill("https://upstream.example.test/oauth2/jwks.json");
    await page.getByLabel("Default provider scopes").fill("openid profile");

    await page.getByRole("button", { name: "Add mapping" }).click();
    await page.getByLabel("App scope").fill("profile:read");
    await page.getByLabel("Provider scopes", { exact: true }).fill("openid profile");

    await page.getByRole("button", { name: "Create client" }).click();

    await expect(page.getByText("Client created").first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Credentials" })).toBeVisible();

    await page.getByRole("link", { name: "Back to list" }).click();
    await expect(page).toHaveURL(/\/admin\/clients$/);

    await page.getByTestId("clients-search-input").fill(clientName);
    const clientRow = page.getByRole("row", { name: new RegExp(clientName, "i") });
    await expect(clientRow).toBeVisible();
    await clientRow.getByRole("link", { name: "Details →" }).click();

    await page.getByLabel("Default provider scopes").fill("openid profile offline_access");
    await page.getByRole("button", { name: "Add mapping" }).click();

    const appScopeInputs = page.getByLabel("App scope");
    await expect(appScopeInputs).toHaveCount(2);
    await appScopeInputs.nth(1).fill("email:read");

    const providerScopeInputs = page.getByLabel("Provider scopes", { exact: true });
    await expect(providerScopeInputs).toHaveCount(2);
    await providerScopeInputs.nth(1).fill("email");

    await page.getByLabel("Provider client secret").fill("rotated-upstream-secret");
    await page.getByLabel("Passthrough token payload").check();

    await page.getByRole("button", { name: "Save changes" }).click();

    await expect(page.getByText("Proxy configuration updated", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Provider client secret")).toHaveValue("");
    await expect(page.locator('input[value="email:read"]')).toBeVisible();
    await expect(page.locator('input[value="email"]')).toBeVisible();
  });
});
