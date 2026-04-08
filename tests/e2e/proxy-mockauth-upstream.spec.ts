import { expect, test, type APIRequestContext, type Page, type TestInfo } from "@playwright/test";
import { calculatePKCECodeChallenge, randomNonce, randomPKCECodeVerifier, randomState } from "openid-client";

import { authenticate, createTestSession, stubClipboard } from "./helpers/admin";
import { cookieJar, withSessionCookies } from "./helpers/oidc";

const DEFAULT_RESOURCE_ID = "tenant_qa_default_resource";
const ISSUER_BASE = `http://127.0.0.1:3000/r/${DEFAULT_RESOURCE_ID}/oidc`;
const PROXY_CALLBACK_URI = `${ISSUER_BASE}/proxy/callback`;
const APP_REDIRECT_URI = "https://proxy-app.example.test/callback";
const APP_SCOPE = "openid profile email offline_access";
const PROXY_TRANSACTION_COOKIE = "mockauth_proxy_tx";

type CreatedClient = {
  name: string;
  clientId: string;
  clientSecret: string;
  detailUrl: string;
  internalId: string;
};

type AuditLogEntry = {
  id: string;
  createdAt: string;
  eventType: string;
  severity: string;
  message: string;
  traceId: string | null;
  client: { id: string; name: string; clientId: string } | null;
  details: Record<string, unknown> | null;
};

type TokenResponse = {
  access_token?: string;
  token_type?: string;
  expires_in?: number | string;
  refresh_token?: string;
  id_token?: string;
  scope?: string;
  diagnostics?: Record<string, unknown>;
};

type ProxyAuthorizeResult = {
  code: string;
  codeVerifier: string;
  state: string;
  transactionId: string;
};

type ProxyAuthorizeErrorResult = {
  error: string;
  errorDescription?: string | null;
  state: string;
  transactionId: string;
};

const buildNameSuffix = (testInfo: TestInfo) => {
  const slug = testInfo.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug}-${testInfo.workerIndex}-${testInfo.parallelIndex}-${testInfo.repeatEachIndex}`;
};

const extractClientIdFromUrl = (detailUrl: string) => {
  const url = new URL(detailUrl, "http://127.0.0.1:3000");
  const segments = url.pathname.split("/").filter(Boolean);
  const clientId = segments[segments.length - 1];
  if (!clientId) {
    throw new Error("Client id missing from detail URL");
  }
  return clientId;
};

const getCopyFieldValue = async (page: Page, testId: string) => {
  const value = await page.getByTestId(testId).locator("code").textContent();
  if (!value) {
    throw new Error(`Missing value for ${testId}`);
  }
  return value.trim();
};

const openClientDetail = async (page: Page, name: string) => {
  await page.goto("/admin/clients");
  await expect(page.getByRole("heading", { name: "OAuth clients" })).toBeVisible();
  await page.getByTestId("clients-search-input").fill(name);
  const row = page.getByRole("row", { name: new RegExp(name, "i") });
  await expect(row).toBeVisible();
  const detailHref = await row.getByRole("link", { name: "Details →" }).getAttribute("href");
  if (!detailHref) {
    throw new Error("Client details link missing");
  }
  await page.goto(detailHref, { waitUntil: "domcontentloaded" });
  await page.waitForURL(/\/admin\/clients\/[0-9a-f-]+$/);
  return new URL(detailHref, "http://127.0.0.1:3000").toString();
};

const createRegularClient = async (page: Page, name: string, redirectUris: string[]): Promise<CreatedClient> => {
  await page.goto("/admin/clients");
  await expect(page.getByRole("heading", { name: "OAuth clients" })).toBeVisible();
  await page.getByRole("link", { name: "Add client" }).click();
  await expect(page.getByRole("heading", { name: "New client" })).toBeVisible();

  await page.getByLabel("Client name").fill(name);
  await page.getByLabel("Redirect URIs").fill(redirectUris.join("\n"));
  await page.getByLabel("Refresh token").check();
  await page.getByRole("button", { name: "Create client" }).click();

  await expect(page.getByText("Client created").first()).toBeVisible();
  await page.getByRole("link", { name: "Back to list" }).click();

  const detailUrl = await openClientDetail(page, name);
  await page.getByTestId("scope-suggestion-offline_access").click();
  await page.getByTestId("scope-save-button").click();
  await expect(page.getByTestId("scope-chip-offline_access")).toBeVisible();
  const clientId = await getCopyFieldValue(page, "oauth-field-client-id");
  const clientSecret = await getCopyFieldValue(page, "oauth-field-client-secret");
  const internalId = extractClientIdFromUrl(detailUrl);
  return { name, clientId, clientSecret, detailUrl, internalId };
};

const createProxyClient = async (
  page: Page,
  params: {
    name: string;
    redirectUris: string[];
    upstreamClientId: string;
    upstreamClientSecret: string;
  },
): Promise<CreatedClient> => {
  await page.goto("/admin/clients");
  await expect(page.getByRole("heading", { name: "OAuth clients" })).toBeVisible();
  await page.getByRole("link", { name: "Add client" }).click();
  await expect(page.getByRole("heading", { name: "New client" })).toBeVisible();

  await page.getByLabel("Client name").fill(params.name);
  await page.getByRole("tab", { name: "Proxy" }).click();
  await page.getByLabel("Provider client ID").fill(params.upstreamClientId);
  await page.getByLabel("Provider client secret").fill(params.upstreamClientSecret);
  await page.getByLabel("Authorization endpoint").fill(`${ISSUER_BASE}/authorize`);
  await page.getByLabel("Token endpoint", { exact: true }).fill(`${ISSUER_BASE}/token`);
  await page.getByLabel("Userinfo endpoint").fill(`${ISSUER_BASE}/userinfo`);
  await page.getByLabel("JWKS URI").fill(`${ISSUER_BASE}/jwks.json`);
  await page.getByLabel("Default provider scopes").fill(APP_SCOPE);
  await page.getByLabel("Redirect URIs").fill(params.redirectUris.join("\n"));

  await page.getByRole("button", { name: "Create client" }).click();
  await expect(page.getByText("Client created").first()).toBeVisible();
  await page.getByRole("link", { name: "Back to list" }).click();

  const detailUrl = await openClientDetail(page, params.name);
  await expect(page.getByRole("heading", { name: "Upstream provider" })).toBeVisible();
  const clientId = await getCopyFieldValue(page, "oauth-field-client-id");
  const clientSecret = await getCopyFieldValue(page, "oauth-field-client-secret");
  const internalId = extractClientIdFromUrl(detailUrl);
  return { name: params.name, clientId, clientSecret, detailUrl, internalId };
};

const updateProxyClientSecret = async (page: Page, detailUrl: string, secret: string) => {
  await page.goto(detailUrl, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Upstream provider" })).toBeVisible();
  await page.getByLabel("Provider client secret").fill(secret);
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Proxy configuration updated", { exact: true })).toBeVisible();
};

const deleteClient = async (page: Page, detailUrl: string) => {
  await page.goto(detailUrl, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("client-danger-delete")).toBeVisible();
  await page.getByTestId("client-danger-delete").click();
  await page.getByTestId("client-danger-confirm").click();
  await expect(page).toHaveURL(/\/admin\/clients$/);
};

const buildProxyAuthorizeUrl = (clientId: string, redirectUri: string, codeChallenge: string, state: string, nonce: string) => {
  const url = new URL(`${ISSUER_BASE}/authorize`);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", APP_SCOPE);
  url.searchParams.set("state", state);
  url.searchParams.set("nonce", nonce);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
};

const performProxyAuthorize = async (params: {
  clientId: string;
  redirectUri: string;
  username: string;
}): Promise<{ redirectLocation: string; codeVerifier: string; state: string; transactionId: string }> => {
  const jar = cookieJar();
  const codeVerifier = randomPKCECodeVerifier();
  const codeChallenge = await calculatePKCECodeChallenge(codeVerifier);
  const state = randomState();
  const nonce = randomNonce();
  const authorizeUrl = buildProxyAuthorizeUrl(params.clientId, params.redirectUri, codeChallenge, state, nonce);

  const authorizeResponse = await fetch(authorizeUrl, { redirect: "manual" });
  jar.addFrom(authorizeResponse);
  expect(authorizeResponse.status).toBe(302);

  const transactionId = jar.get(PROXY_TRANSACTION_COOKIE);
  if (!transactionId) {
    throw new Error("Proxy transaction cookie missing");
  }

  const upstreamAuthorizeLocation = authorizeResponse.headers.get("location");
  if (!upstreamAuthorizeLocation) {
    throw new Error("Proxy authorize did not redirect to upstream");
  }

  const upstreamAuthorizeUrl = new URL(upstreamAuthorizeLocation, "http://127.0.0.1:3000");
  const upstreamAuthorizeResponse = await fetch(upstreamAuthorizeUrl, {
    redirect: "manual",
    headers: withSessionCookies(jar),
  });
  jar.addFrom(upstreamAuthorizeResponse);
  expect(upstreamAuthorizeResponse.status).toBe(302);

  const loginLocation = upstreamAuthorizeResponse.headers.get("location");
  if (!loginLocation) {
    throw new Error("Upstream authorize did not redirect to login");
  }

  const loginUrl = new URL(loginLocation, "http://127.0.0.1:3000");
  const loginSegments = loginUrl.pathname.split("/").filter(Boolean);
  const resourceId = loginSegments[1];
  if (!resourceId) {
    throw new Error("Login redirect missing resource id");
  }
  loginUrl.pathname = `/r/${resourceId}/oidc/login/submit`;

  const loginResponse = await fetch(loginUrl, {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: jar.header(),
    },
    body: new URLSearchParams({
      strategy: "username",
      username: params.username,
      return_to: upstreamAuthorizeUrl.toString(),
    }).toString(),
  });
  jar.addFrom(loginResponse);
  expect(loginResponse.status).toBe(303);

  const authorizeAfterLoginLocation = loginResponse.headers.get("location");
  if (!authorizeAfterLoginLocation) {
    throw new Error("Login did not redirect back to authorize");
  }

  const authorizeAfterLogin = await fetch(authorizeAfterLoginLocation, {
    redirect: "manual",
    headers: withSessionCookies(jar),
  });
  jar.addFrom(authorizeAfterLogin);
  expect(authorizeAfterLogin.status).toBe(302);

  const callbackLocation = authorizeAfterLogin.headers.get("location");
  if (!callbackLocation) {
    throw new Error("Authorize did not redirect to callback");
  }

  const callbackResponse = await fetch(callbackLocation, {
    redirect: "manual",
    headers: withSessionCookies(jar),
  });
  jar.addFrom(callbackResponse);
  expect(callbackResponse.status).toBe(302);

  const redirectLocation = callbackResponse.headers.get("location");
  if (!redirectLocation) {
    throw new Error("Proxy callback did not redirect to app");
  }

  return { redirectLocation, codeVerifier, state, transactionId };
};

const runProxyAuthorization = async (params: {
  clientId: string;
  redirectUri: string;
  username: string;
}): Promise<ProxyAuthorizeResult> => {
  const result = await performProxyAuthorize(params);
  const redirectUrl = new URL(result.redirectLocation);
  const code = redirectUrl.searchParams.get("code");
  if (!code) {
    throw new Error(`Proxy authorization code missing: ${redirectUrl.toString()}`);
  }
  const state = redirectUrl.searchParams.get("state");
  expect(state).toBe(result.state);
  return {
    code,
    codeVerifier: result.codeVerifier,
    state: result.state,
    transactionId: result.transactionId,
  };
};

const runProxyAuthorizationError = async (params: {
  clientId: string;
  redirectUri: string;
  username: string;
}): Promise<ProxyAuthorizeErrorResult> => {
  const result = await performProxyAuthorize(params);
  const redirectUrl = new URL(result.redirectLocation);
  const error = redirectUrl.searchParams.get("error");
  if (!error) {
    throw new Error(`Expected proxy authorization error: ${redirectUrl.toString()}`);
  }
  const state = redirectUrl.searchParams.get("state");
  expect(state).toBe(result.state);
  return {
    error,
    errorDescription: redirectUrl.searchParams.get("error_description"),
    state: result.state,
    transactionId: result.transactionId,
  };
};

const basicAuthHeader = (clientId: string, clientSecret: string) => {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
};

const requestProxyToken = async (params: {
  clientId: string;
  clientSecret: string;
  code: string;
  codeVerifier: string;
  redirectUri: string;
}) => {
  const response = await fetch(`${ISSUER_BASE}/token`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      authorization: basicAuthHeader(params.clientId, params.clientSecret),
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: params.code,
      redirect_uri: params.redirectUri,
      code_verifier: params.codeVerifier,
    }).toString(),
  });
  const payload = (await response.json()) as Record<string, unknown>;
  return { response, payload };
};

const requestProxyRefresh = async (params: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  scope?: string;
}) => {
  const body = new URLSearchParams({ grant_type: "refresh_token" });
  body.set("refresh_token", params.refreshToken);
  if (params.scope) {
    body.set("scope", params.scope);
  }

  const response = await fetch(`${ISSUER_BASE}/token`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      authorization: basicAuthHeader(params.clientId, params.clientSecret),
    },
    body: body.toString(),
  });
  const payload = (await response.json()) as Record<string, unknown>;
  return { response, payload };
};

const fetchAuditLogs = async (
  request: APIRequestContext,
  params: { traceId?: string; clientId?: string; eventType?: string },
): Promise<AuditLogEntry[]> => {
  const searchParams = new URLSearchParams();
  if (params.traceId) {
    searchParams.set("traceId", params.traceId);
  }
  if (params.clientId) {
    searchParams.set("clientId", params.clientId);
  }
  if (params.eventType) {
    searchParams.set("eventType", params.eventType);
  }
  const response = await request.get(`/api/test/audit-logs?${searchParams.toString()}`);
  if (!response.ok()) {
    throw new Error(`Audit log request failed: ${response.status()}`);
  }
  const payload = (await response.json()) as { logs: AuditLogEntry[] };
  return payload.logs;
};

const fetchProxyTokenExchange = async (request: APIRequestContext, transactionId: string) => {
  const response = await request.get(`/api/test/proxy/token-exchange?transactionId=${transactionId}`);
  if (!response.ok()) {
    throw new Error(`Proxy token exchange request failed: ${response.status()}`);
  }
  const payload = (await response.json()) as {
    exchange: { providerResponse: Record<string, unknown> };
  };
  return payload.exchange;
};

const updateClientScopes = async (request: APIRequestContext, clientId: string, scopes: string[]) => {
  const response = await request.post("/api/test/clients/scopes", {
    data: { clientId, scopes },
  });
  if (!response.ok()) {
    throw new Error(`Client scopes update failed: ${response.status()}`);
  }
};

const findAuditEvent = (logs: AuditLogEntry[], eventType: string, severity?: string) => {
  const match = logs.find((log) => log.eventType === eventType && (!severity || log.severity === severity));
  expect(match, `Missing audit event ${eventType}`).toBeTruthy();
  return match!;
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

const completeProviderLogin = async (page: Page, clientId: string, username: string) => {
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
    await page.getByRole("textbox", { name: /^Username/ }).fill(username);
    await Promise.all([
      page.waitForURL((url) => redirectPattern.test(url.toString())),
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
  }

  await waitForTestResult();
};

const runStandardTestOauth = async (page: Page, params: { clientId: string; clientSecret: string; username: string }) => {
  await page.goto(`/admin/clients/${params.clientId}/test`, { waitUntil: "domcontentloaded" });
  const startButton = page.getByTestId("test-oauth-start");
  await expect(startButton).toBeVisible();
  await addTestRedirectIfNeeded(page);
  const secretInput = page.getByTestId("test-oauth-secret-input");
  await expect(secretInput).toBeVisible();
  await secretInput.fill(params.clientSecret);
  await startButton.click();

  const textarea = page.getByTestId("test-oauth-authorization-textarea");
  await expect(textarea).toBeVisible();
  await page.getByTestId("test-oauth-authorization-open").click();
  await completeProviderLogin(page, params.clientId, params.username);
};

test.describe("proxy mockauth upstream", () => {
  test.beforeEach(async ({ page }) => {
    const sessionToken = await createTestSession(page);
    await authenticate(page, sessionToken);
    await stubClipboard(page);
  });

  test("proxy authorize exchange returns upstream tokens", async ({ page, request }, testInfo) => {
    const suffix = buildNameSuffix(testInfo);
    const upstreamName = `Proxy Upstream ${suffix}`;
    const proxyName = `Proxy Client ${suffix}`;
    let upstream: CreatedClient | null = null;
    let proxy: CreatedClient | null = null;

    try {
      upstream = await createRegularClient(page, upstreamName, [PROXY_CALLBACK_URI]);
      proxy = await createProxyClient(page, {
        name: proxyName,
        redirectUris: [APP_REDIRECT_URI],
        upstreamClientId: upstream.clientId,
        upstreamClientSecret: upstream.clientSecret,
      });
      await updateClientScopes(request, proxy.internalId, ["openid", "profile", "email", "offline_access"]);

      const authorization = await runProxyAuthorization({
        clientId: proxy.clientId,
        redirectUri: APP_REDIRECT_URI,
        username: "proxy-user",
      });

      const tokenResponse = await requestProxyToken({
        clientId: proxy.clientId,
        clientSecret: proxy.clientSecret,
        code: authorization.code,
        codeVerifier: authorization.codeVerifier,
        redirectUri: APP_REDIRECT_URI,
      });

      expect(tokenResponse.response.ok).toBeTruthy();
      const tokenPayload = tokenResponse.payload as TokenResponse;
      expect(typeof tokenPayload.access_token).toBe("string");
      expect(tokenPayload.token_type).toBe("Bearer");
      expect(tokenPayload.expires_in).toBeDefined();
      expect(tokenPayload.scope).toContain("openid");
      expect(tokenPayload.scope).toContain("offline_access");
      if (tokenPayload.id_token !== undefined) {
        expect(typeof tokenPayload.id_token).toBe("string");
      }
      if (!tokenPayload.refresh_token) {
        throw new Error("Refresh token missing from proxy token response");
      }
      const refreshToken = tokenPayload.refresh_token;

      const auditLogs = await fetchAuditLogs(request, { traceId: authorization.transactionId });
      const callbackSuccess = findAuditEvent(auditLogs, "PROXY_CALLBACK_SUCCESS", "INFO");
      expect(callbackSuccess.traceId).toBe(authorization.transactionId);
      const callbackDetails = callbackSuccess.details as Record<string, unknown>;
      const callbackTokenResponse = callbackDetails?.tokenResponse as Record<string, unknown> | undefined;
      if (!callbackTokenResponse) {
        throw new Error("Proxy callback token response missing");
      }
      expect(callbackTokenResponse.refresh_token).toBe(refreshToken);
      const tokenCompleted = findAuditEvent(auditLogs, "TOKEN_AUTHCODE_COMPLETED", "INFO");
      const completedDetails = tokenCompleted.details as Record<string, unknown>;
      expect(completedDetails?.upstreamCall).toBe(false);
      expect(typeof completedDetails?.access_token).toBe("string");
      expect(completedDetails?.token_type).toBe("Bearer");
      expect(completedDetails?.expires_in).toBeDefined();
      expect(completedDetails?.refresh_token).toBe(refreshToken);

      const providerResponse = completedDetails?.providerResponse as Record<string, unknown> | undefined;
      if (!providerResponse) {
        throw new Error("Provider response missing from audit log");
      }
      expect(providerResponse.access_token).toBe(tokenPayload.access_token);
      expect(providerResponse.refresh_token).toBe(refreshToken);
      if (tokenPayload.id_token) {
        expect(providerResponse.id_token).toBe(tokenPayload.id_token);
      }
      const tokenExchange = await fetchProxyTokenExchange(request, authorization.transactionId);
      expect(tokenExchange.providerResponse.refresh_token).toBe(refreshToken);

      const refreshResponse = await requestProxyRefresh({
        clientId: proxy.clientId,
        clientSecret: proxy.clientSecret,
        refreshToken,
        scope: tokenPayload.scope,
      });
      expect(refreshResponse.response.ok).toBeTruthy();
      const refreshPayload = refreshResponse.payload as TokenResponse;
      expect(typeof refreshPayload.access_token).toBe("string");
      if (!refreshPayload.refresh_token) {
        throw new Error("Refresh token missing from refresh response");
      }

      const refreshLogs = await fetchAuditLogs(request, {
        clientId: proxy.internalId,
        eventType: "TOKEN_REFRESH_COMPLETED",
      });
      const refreshEvent = findAuditEvent(refreshLogs, "TOKEN_REFRESH_COMPLETED", "INFO");
      const refreshDetails = refreshEvent.details as TokenResponse;
      expect(refreshDetails.diagnostics).toBeTruthy();
      expect(refreshDetails.refresh_token).toBe(refreshPayload.refresh_token);

      const upstreamRefreshReceivedLogs = await fetchAuditLogs(request, {
        clientId: upstream.internalId,
        eventType: "TOKEN_REFRESH_RECEIVED",
      });
      const upstreamRefreshReceived = findAuditEvent(upstreamRefreshReceivedLogs, "TOKEN_REFRESH_RECEIVED", "INFO");
      const upstreamReceivedDetails = upstreamRefreshReceived.details as Record<string, unknown>;
      expect(upstreamReceivedDetails.refreshToken).toBe(refreshToken);

      const upstreamRefreshLogs = await fetchAuditLogs(request, {
        clientId: upstream.internalId,
        eventType: "TOKEN_REFRESH_COMPLETED",
      });
      const upstreamRefresh = findAuditEvent(upstreamRefreshLogs, "TOKEN_REFRESH_COMPLETED", "INFO");
      const upstreamRefreshDetails = upstreamRefresh.details as TokenResponse;
      expect(typeof upstreamRefreshDetails.access_token).toBe("string");
      expect(typeof upstreamRefreshDetails.refresh_token).toBe("string");
    } finally {
      if (proxy) {
        await deleteClient(page, proxy.detailUrl);
      }
      if (upstream) {
        await deleteClient(page, upstream.detailUrl);
      }
    }
  });

  test("consumed proxy code returns invalid_grant with audit", async ({ page, request }, testInfo) => {
    const suffix = buildNameSuffix(testInfo);
    const upstreamName = `Proxy Upstream ${suffix}`;
    const proxyName = `Proxy Client ${suffix}`;
    let upstream: CreatedClient | null = null;
    let proxy: CreatedClient | null = null;

    try {
      upstream = await createRegularClient(page, upstreamName, [PROXY_CALLBACK_URI]);
      proxy = await createProxyClient(page, {
        name: proxyName,
        redirectUris: [APP_REDIRECT_URI],
        upstreamClientId: upstream.clientId,
        upstreamClientSecret: upstream.clientSecret,
      });
      await updateClientScopes(request, proxy.internalId, ["openid", "profile", "email", "offline_access"]);

      const authorization = await runProxyAuthorization({
        clientId: proxy.clientId,
        redirectUri: APP_REDIRECT_URI,
        username: "proxy-user",
      });

      const firstExchange = await requestProxyToken({
        clientId: proxy.clientId,
        clientSecret: proxy.clientSecret,
        code: authorization.code,
        codeVerifier: authorization.codeVerifier,
        redirectUri: APP_REDIRECT_URI,
      });
      expect(firstExchange.response.ok).toBeTruthy();

      const secondExchange = await requestProxyToken({
        clientId: proxy.clientId,
        clientSecret: proxy.clientSecret,
        code: authorization.code,
        codeVerifier: authorization.codeVerifier,
        redirectUri: APP_REDIRECT_URI,
      });
      expect(secondExchange.response.status).toBe(400);
      expect(secondExchange.payload.error).toBe("invalid_grant");

      const auditLogs = await fetchAuditLogs(request, { traceId: authorization.transactionId });
      const errorEvent = findAuditEvent(auditLogs, "TOKEN_AUTHCODE_COMPLETED", "ERROR");
      const errorDetails = errorEvent.details as Record<string, unknown>;
      expect(errorDetails?.error).toBe("invalid_grant");
    } finally {
      if (proxy) {
        await deleteClient(page, proxy.detailUrl);
      }
      if (upstream) {
        await deleteClient(page, upstream.detailUrl);
      }
    }
  });

  test("proxy callback recovers after upstream secret fix", async ({ page, request }, testInfo) => {
    const suffix = buildNameSuffix(testInfo);
    const upstreamName = `Proxy Upstream ${suffix}`;
    const proxyName = `Proxy Client ${suffix}`;
    let upstream: CreatedClient | null = null;
    let proxy: CreatedClient | null = null;

    try {
      upstream = await createRegularClient(page, upstreamName, [PROXY_CALLBACK_URI]);
      proxy = await createProxyClient(page, {
        name: proxyName,
        redirectUris: [APP_REDIRECT_URI],
        upstreamClientId: upstream.clientId,
        upstreamClientSecret: upstream.clientSecret,
      });
      await updateClientScopes(request, proxy.internalId, ["openid", "profile", "email", "offline_access"]);

      await updateProxyClientSecret(page, proxy.detailUrl, "bad-secret");
      const failedAuthorization = await runProxyAuthorizationError({
        clientId: proxy.clientId,
        redirectUri: APP_REDIRECT_URI,
        username: "proxy-user",
      });
      expect(failedAuthorization.error).toBe("invalid_client");

      const auditLogs = await fetchAuditLogs(request, { traceId: failedAuthorization.transactionId });
      const callbackError = findAuditEvent(auditLogs, "PROXY_CALLBACK_ERROR", "ERROR");
      const callbackDetails = callbackError.details as Record<string, unknown>;
      expect(callbackDetails?.error).toBe("invalid_client");

      await updateProxyClientSecret(page, proxy.detailUrl, upstream.clientSecret);
      const authorization = await runProxyAuthorization({
        clientId: proxy.clientId,
        redirectUri: APP_REDIRECT_URI,
        username: "proxy-user",
      });
      const tokenResponse = await requestProxyToken({
        clientId: proxy.clientId,
        clientSecret: proxy.clientSecret,
        code: authorization.code,
        codeVerifier: authorization.codeVerifier,
        redirectUri: APP_REDIRECT_URI,
      });
      expect(tokenResponse.response.ok).toBeTruthy();
    } finally {
      if (proxy) {
        await deleteClient(page, proxy.detailUrl);
      }
      if (upstream) {
        await deleteClient(page, upstream.detailUrl);
      }
    }
  });

  test("standard test OAuth flow recovers after upstream secret fix", async ({ page, request }, testInfo) => {
    const suffix = buildNameSuffix(testInfo);
    const upstreamName = `Proxy Test Upstream ${suffix}`;
    const proxyName = `Proxy Test Client ${suffix}`;
    let upstream: CreatedClient | null = null;
    let proxy: CreatedClient | null = null;

    try {
      upstream = await createRegularClient(page, upstreamName, [PROXY_CALLBACK_URI]);
      proxy = await createProxyClient(page, {
        name: proxyName,
        redirectUris: [APP_REDIRECT_URI],
        upstreamClientId: upstream.clientId,
        upstreamClientSecret: upstream.clientSecret,
      });

      await runStandardTestOauth(page, {
        clientId: proxy.internalId,
        clientSecret: proxy.clientSecret,
        username: "proxy-user",
      });
      await expect(page.getByTestId("test-oauth-id-token")).toBeVisible();
      await expect(page.getByTestId("test-oauth-access-token")).toBeVisible();

      const successLogs = await fetchAuditLogs(request, {
        clientId: proxy.internalId,
        eventType: "TOKEN_AUTHCODE_COMPLETED",
      });
      const successEvent = findAuditEvent(successLogs, "TOKEN_AUTHCODE_COMPLETED", "INFO");
      const successDetails = successEvent.details as Record<string, unknown>;
      expect(successDetails?.upstreamCall).toBe(false);

      await updateProxyClientSecret(page, proxy.detailUrl, "bad-secret");
      await runStandardTestOauth(page, {
        clientId: proxy.internalId,
        clientSecret: proxy.clientSecret,
        username: "proxy-user",
      });
      await expect(page.getByTestId("test-oauth-error")).toContainText("invalid_client");

      const errorLogs = await fetchAuditLogs(request, {
        clientId: proxy.internalId,
        eventType: "PROXY_CALLBACK_ERROR",
      });
      const errorEvent = findAuditEvent(errorLogs, "PROXY_CALLBACK_ERROR", "ERROR");
      const errorDetails = errorEvent.details as Record<string, unknown>;
      expect(errorDetails?.error).toBe("invalid_client");

      await updateProxyClientSecret(page, proxy.detailUrl, upstream.clientSecret);
      await runStandardTestOauth(page, {
        clientId: proxy.internalId,
        clientSecret: proxy.clientSecret,
        username: "proxy-user",
      });
      await expect(page.getByTestId("test-oauth-id-token")).toBeVisible();
      await expect(page.getByTestId("test-oauth-access-token")).toBeVisible();
    } finally {
      if (proxy) {
        await deleteClient(page, proxy.detailUrl);
      }
      if (upstream) {
        await deleteClient(page, upstream.detailUrl);
      }
    }
  });
});
