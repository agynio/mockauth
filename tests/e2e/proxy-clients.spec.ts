import http from "node:http";
import type { AddressInfo } from "node:net";

import { expect, test } from "@playwright/test";

import { authenticate, createTestSession, stubClipboard } from "./helpers/admin";

test.describe("proxy clients", () => {
  test("creates a proxy client and updates provider config", async ({ page, request }) => {
    const receivedRequests: Array<{ headers: http.IncomingHttpHeaders; params: URLSearchParams }> = [];
    const server = http.createServer((req, res) => {
      if (req.method !== "POST") {
        res.statusCode = 405;
        res.end();
        return;
      }
      const chunks: Buffer[] = [];
      req.on("data", (chunk) => chunks.push(chunk as Buffer));
      req.on("end", () => {
        const body = Buffer.concat(chunks).toString();
        const params = new URLSearchParams(body);
        receivedRequests.push({ headers: req.headers, params });
        res.setHeader("content-type", "application/json");
        if (!params.get("client_secret")) {
          res.statusCode = 401;
          res.end(JSON.stringify({ error: "invalid_client" }));
          return;
        }
        if (params.get("grant_type") === "authorization_code") {
          res.statusCode = 200;
          res.end(
            JSON.stringify({
              access_token: "stub-access",
              refresh_token: "stub-refresh-response",
              token_type: "Bearer",
              expires_in: 3600,
              scope: params.get("scope") ?? "openid profile",
            }),
          );
          return;
        }
        res.statusCode = 200;
        res.end(
          JSON.stringify({
            access_token: "stub-access-refresh",
            refresh_token: "stub-refresh-next",
            token_type: "Bearer",
            expires_in: 1800,
          }),
        );
      });
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    const upstreamBase = `http://127.0.0.1:${port}`;

    try {
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
      await page.getByLabel("Authorization endpoint").fill(`${upstreamBase}/oauth2/authorize`);
      await page.getByLabel("Token endpoint", { exact: true }).fill(`${upstreamBase}/oauth2/token`);
      await page.getByLabel("Userinfo endpoint").fill(`${upstreamBase}/oauth2/userinfo`);
      await page.getByLabel("JWKS URI").fill(`${upstreamBase}/oauth2/jwks.json`);
      await page.getByLabel("Default provider scopes").fill("openid profile");

      const tokenAuthSelect = page.getByRole("combobox", { name: "Token endpoint auth" });
      await tokenAuthSelect.click();
      await page.getByRole("option", { name: "POST body (client_secret_post)" }).click();

      await page.getByRole("button", { name: "Add mapping" }).click();
      await page.getByLabel("App scope").fill("profile:read");
      await page.getByLabel("Provider scopes", { exact: true }).fill("openid profile");

      await page.getByRole("button", { name: "Create client" }).click();

      await expect(page.getByText("Client created").first()).toBeVisible();
      await expect(page.getByRole("heading", { name: "Credentials" })).toBeVisible();
      await expect(page.getByTestId("provider-redirect-uri")).toContainText("/oidc/proxy/callback");

      await page.getByRole("link", { name: "Back to list" }).click();
      await expect(page).toHaveURL(/\/admin\/clients$/);

      await page.getByTestId("clients-search-input").fill(clientName);
      const clientRow = page.getByRole("row", { name: new RegExp(clientName, "i") });
      await expect(clientRow).toBeVisible();
      const detailsHref = await clientRow.getByRole("link", { name: "Details →" }).getAttribute("href");
      expect(detailsHref).toBeTruthy();
      await page.goto(detailsHref!, { waitUntil: "domcontentloaded" });
      await page.waitForURL(/\/admin\/clients\/[0-9a-f-]+$/);
      await expect(page.getByRole("heading", { name: "Upstream provider" })).toBeVisible();
      await expect(page.getByTestId("provider-redirect-uri-redirect")).toContainText("/oidc/proxy/callback");
      await expect(page.getByTestId("proxy-mode-note")).toBeVisible();
      await expect(page.locator('[data-testid="client-scopes-card"]')).toHaveCount(0);
      await expect(page.locator('[data-testid="client-auth-strategies-card"]')).toHaveCount(0);
      await expect(page.locator('[data-testid="client-signing-card"]')).toHaveCount(0);
      await expect(page.locator('[data-testid="client-reauth-card"]')).toHaveCount(0);

      const persistedTokenAuthSelect = page.getByRole("combobox", { name: "Token endpoint auth" });
      await expect(persistedTokenAuthSelect).toHaveAttribute("data-selected-value", "client_secret_post");

      const storedSecret = page.getByTestId("proxy-stored-secret");
      await expect(storedSecret).toBeVisible();
      await expect(page.getByTestId("proxy-secret-caution")).toContainText("Revealed secrets render only in your browser");

      const storedSecretInput = storedSecret.locator("input");
      await expect(storedSecretInput).toHaveAttribute("type", "password");

      const revealSecretButton = storedSecret.getByRole("button", { name: "Reveal upstream secret" });
      await revealSecretButton.click();
      await expect(storedSecretInput).toHaveAttribute("type", "text");
      await expect(storedSecretInput).toHaveValue("proxy-upstream-secret");

      await storedSecret.getByRole("button", { name: "Copy upstream secret" }).click();
      const copiedValue = await page.evaluate(
        () => (window as typeof window & { __mockClipboard?: string }).__mockClipboard ?? "",
      );
      expect(copiedValue).toBe("proxy-upstream-secret");

      await storedSecret.getByRole("button", { name: "Hide upstream secret" }).click();
      await expect(storedSecretInput).toHaveAttribute("type", "password");

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

      const storedSecretAfterUpdate = page.getByTestId("proxy-stored-secret");
      const storedSecretInputAfterUpdate = storedSecretAfterUpdate.locator("input");
      await expect(storedSecretInputAfterUpdate).toHaveAttribute("type", "password");
      await storedSecretAfterUpdate.getByRole("button", { name: "Reveal upstream secret" }).click();
      await expect(storedSecretInputAfterUpdate).toHaveValue("rotated-upstream-secret");

      const clientIdField = page.getByTestId("oauth-field-client-id").locator("code");
      const clientIdValue = (await clientIdField.textContent())?.trim();
      expect(clientIdValue).toBeTruthy();
      if (!clientIdValue) {
        throw new Error("client id missing");
      }

      const authorizationResponse = await request.post("/api/test/proxy/request-tokens", {
        data: {
          clientId: clientIdValue,
          tenantId: "tenant_qa",
          parameters: {
            grant_type: "authorization_code",
            code: "stub-provider-code",
            redirect_uri: `${upstreamBase}/callback`,
            code_verifier: "stub-code-verifier",
            scope: "openid profile",
          },
        },
      });
      expect(authorizationResponse.ok()).toBeTruthy();
      const authorizationJson = await authorizationResponse.json();
      expect(authorizationJson.ok).toBe(true);

      const refreshResponse = await request.post("/api/test/proxy/request-tokens", {
        data: {
          clientId: clientIdValue,
          tenantId: "tenant_qa",
          parameters: {
            grant_type: "refresh_token",
            refresh_token: "stub-refresh-response",
            scope: "openid profile",
          },
        },
      });
      expect(refreshResponse.ok()).toBeTruthy();
      const refreshJson = await refreshResponse.json();
      expect(refreshJson.ok).toBe(true);

      expect(receivedRequests).toHaveLength(2);
      const [authRequest, refreshRequest] = receivedRequests;
      expect(authRequest.headers.authorization).toBeUndefined();
      expect(refreshRequest.headers.authorization).toBeUndefined();
      expect(authRequest.params.get("client_id")).toBe("proxy-upstream-client");
      expect(refreshRequest.params.get("client_id")).toBe("proxy-upstream-client");
      expect(authRequest.params.get("client_secret")).toBe("rotated-upstream-secret");
      expect(refreshRequest.params.get("client_secret")).toBe("rotated-upstream-secret");
      expect(authRequest.params.get("grant_type")).toBe("authorization_code");
      expect(authRequest.params.get("code")).toBe("stub-provider-code");
      expect(authRequest.params.get("redirect_uri")).toBe(`${upstreamBase}/callback`);
      expect(authRequest.params.get("code_verifier")).toBe("stub-code-verifier");
      expect(refreshRequest.params.get("grant_type")).toBe("refresh_token");
      expect(refreshRequest.params.get("refresh_token")).toBe("stub-refresh-response");
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
  });

  test("updates proxy auth strategy from the detail page", async ({ page }) => {
    const sessionToken = await createTestSession(page);
    await authenticate(page, sessionToken);
    await stubClipboard(page);

    await page.goto("/admin/clients");
    await expect(page.getByRole("heading", { name: "OAuth clients" })).toBeVisible();

    const clientName = `Proxy Strategy ${Date.now()}`;

    await page.getByRole("link", { name: "Add client" }).click();
    await expect(page.getByRole("heading", { name: "New client" })).toBeVisible();

    await page.getByLabel("Client name").fill(clientName);
    await page.getByRole("tab", { name: "Proxy" }).click();
    await page.getByLabel("Provider client ID").fill("proxy-strategy-client");
    await page.getByLabel("Provider client secret").fill("proxy-strategy-secret");
    await page.getByLabel("Authorization endpoint").fill("https://strategy.example.test/oauth2/authorize");
    await page.getByLabel("Token endpoint", { exact: true }).fill("https://strategy.example.test/oauth2/token");

    await page.getByRole("button", { name: "Create client" }).click();

    await expect(page.getByText("Client created").first()).toBeVisible();
    await page.getByRole("link", { name: "Back to list" }).click();
    await expect(page).toHaveURL(/\/admin\/clients$/);

    await page.getByTestId("clients-search-input").fill(clientName);
    const clientRow = page.getByRole("row", { name: new RegExp(clientName, "i") });
    await expect(clientRow).toBeVisible();
    const detailsHref = await clientRow.getByRole("link", { name: "Details →" }).getAttribute("href");
    expect(detailsHref).toBeTruthy();
    await page.goto(detailsHref!, { waitUntil: "domcontentloaded" });
    await page.waitForURL(/\/admin\/clients\/[0-9a-f-]+$/);

    await expect(page.getByRole("heading", { name: "Upstream provider" })).toBeVisible();

    const redirectCheckbox = page.getByTestId("proxy-strategy-redirect-enabled");
    const preauthorizedCheckbox = page.getByTestId("proxy-strategy-preauthorized-enabled");

    await expect(redirectCheckbox).toBeChecked();
    await expect(preauthorizedCheckbox).not.toBeChecked();

    await preauthorizedCheckbox.check();
    await page.getByRole("button", { name: "Save strategies" }).click();

    await expect(page.getByText("Proxy auth strategies updated").first()).toBeVisible();
    await expect(page.getByTestId("preauthorized-identities")).toBeVisible();
    await expect(redirectCheckbox).toBeChecked();
    await expect(preauthorizedCheckbox).toBeChecked();

    await redirectCheckbox.uncheck();
    await page.getByRole("button", { name: "Save strategies" }).click();

    await expect(page.getByText("Proxy auth strategies updated").first()).toBeVisible();
    await expect(redirectCheckbox).not.toBeChecked();
    await expect(preauthorizedCheckbox).toBeChecked();

    await preauthorizedCheckbox.uncheck();
    await page.getByRole("button", { name: "Save strategies" }).click();

    await expect(page.getByText("Enable at least one strategy")).toBeVisible();
    await expect(redirectCheckbox).not.toBeChecked();
    await expect(preauthorizedCheckbox).not.toBeChecked();

    await redirectCheckbox.check();
    await page.getByRole("button", { name: "Save strategies" }).click();

    await expect(page.getByText("Proxy auth strategies updated").first()).toBeVisible();
    await expect(redirectCheckbox).toBeChecked();
    await expect(preauthorizedCheckbox).not.toBeChecked();
    await expect(page.locator('[data-testid="preauthorized-identities"]')).toHaveCount(0);

    await page.reload();
    await expect(page.getByRole("heading", { name: "Upstream provider" })).toBeVisible();
    await expect(redirectCheckbox).toBeChecked();
    await expect(preauthorizedCheckbox).not.toBeChecked();
    await expect(page.locator('[data-testid="preauthorized-identities"]')).toHaveCount(0);
  });

  test("honors provider type selection when creating proxy clients", async ({ page }) => {
    const sessionToken = await createTestSession(page);
    await authenticate(page, sessionToken);
    await stubClipboard(page);

    await page.goto("/admin/clients");
    await expect(page.getByRole("heading", { name: "OAuth clients" })).toBeVisible();

    const clientName = `Proxy Provider ${Date.now()}`;

    await page.getByRole("link", { name: "Add client" }).click();
    await expect(page.getByRole("heading", { name: "New client" })).toBeVisible();

    await page.getByLabel("Client name").fill(clientName);
    await page.getByRole("tab", { name: "Proxy" }).click();

    const providerSelect = page.getByRole("combobox", { name: "Provider type" });
    await expect(providerSelect).toHaveAttribute("data-selected-value", "oidc");
    await providerSelect.click();
    const openIdOption = page.getByRole("option", { name: "OpenID Connect" });
    await expect(openIdOption).toHaveAttribute("data-state", "checked");
    await page.getByRole("option", { name: "OAuth 2.0" }).click({ force: true });
    const tokenAuthSelect = page.getByRole("combobox", { name: "Token endpoint auth" });
    await expect(tokenAuthSelect).toHaveAttribute("data-selected-value", "client_secret_basic");
    await page.getByLabel("Provider client ID").fill("provider-upstream");
    await page.getByLabel("Authorization endpoint").fill("https://upstream.example.test/oauth2/authorize");
    await page.getByLabel("Token endpoint", { exact: true }).fill("https://upstream.example.test/oauth2/token");

    await page.getByRole("button", { name: "Create client" }).click();

    await expect(page.getByText("Client created").first()).toBeVisible();

    await page.getByRole("link", { name: "Back to list" }).click();
    await expect(page).toHaveURL(/\/admin\/clients$/);

    await page.getByTestId("clients-search-input").fill(clientName);
    const clientRow = page.getByRole("row", { name: new RegExp(clientName, "i") });
    await expect(clientRow).toBeVisible();
    const detailsHref = await clientRow.getByRole("link", { name: "Details →" }).getAttribute("href");
    expect(detailsHref).toBeTruthy();
    await page.goto(detailsHref!, { waitUntil: "domcontentloaded" });
    await page.waitForURL(/\/admin\/clients\/[0-9a-f-]+$/);
    await expect(page.getByRole("heading", { name: "Upstream provider" })).toBeVisible();
    const persistedSelect = page.getByRole("combobox", { name: "Provider type" });
    await persistedSelect.click();
    await expect(page.getByRole("option", { name: "OAuth 2.0" })).toHaveAttribute("data-state", "checked");
    await page.keyboard.press("Escape");
  });
});
