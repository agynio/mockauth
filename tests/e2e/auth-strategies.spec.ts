import { expect, test, type Locator, type Page } from "@playwright/test";
import { decodeJwt } from "jose";
import { calculatePKCECodeChallenge, randomNonce, randomPKCECodeVerifier, randomState } from "openid-client";

import type { ClientAuthStrategies } from "@/server/oidc/auth-strategy";
import { authenticate, createTestSession } from "./helpers/admin";
import {
  buildAuthorizeUrl,
  cookieJar,
  fetchUserInfoClaims,
  redirectUri,
  runEmailFlow,
  withSessionCookies,
  type DecodedIdToken,
  type UserInfoClaims,
} from "./helpers/oidc";

const tenantId = "tenant_qa";
const resourceId = "tenant_qa_default_resource";
const clientId = "qa-client";
const clientSecret = "qa-secret";

test.describe("auth strategy persistence", () => {
  test("admin UI saves subject source and email verified mode and flows honor them", async ({ page }) => {
    await setClientStrategies(page, {
      username: { enabled: true, subSource: "entered" },
      email: { enabled: false, subSource: "entered", emailVerifiedMode: "false" },
    });

    const sessionToken = await createTestSession(page, { tenantId, role: "OWNER" });
    await authenticate(page, sessionToken);

    await page.goto("/admin/clients");
    await selectTenant(page, tenantId);
    const searchBox = page.getByRole("textbox", { name: "Search clients" });
    await searchBox.fill("QA Client");
    const clientRow = page.getByRole("row", { name: /QA Client/i }).first();
    await expect(clientRow).toBeVisible();
    const detailsLink = clientRow.getByRole("link", { name: "Details →" });
    await expect(detailsLink).toBeVisible();
    const clientHref = await detailsLink.getAttribute("href");
    expect(clientHref).toBeTruthy();
    await page.goto(clientHref!, { waitUntil: "domcontentloaded" });
    await updateSelect(page, page.getByTestId("strategy-username-subsource"), "Generate UUID (stable per identity)");
    const emailToggle = page.getByTestId("strategy-email-enabled");
    await emailToggle.check();
    await updateSelect(page, page.getByTestId("strategy-email-subsource"), "Generate UUID (stable per identity)");
    await updateSelect(page, page.getByTestId("strategy-email-verified-mode"), "Allow QA to choose");

    const saveButton = page.getByRole("button", { name: "Save strategies" });
    await expect(saveButton).toBeEnabled();
    await saveButton.click();
    await expect(page.getByText("Auth strategies updated").first()).toBeVisible();
    await expect.poll(async () => (await getClientStrategies(page)).username.subSource, { timeout: 10_000 }).toBe(
      "generated_uuid",
    );
    await expect.poll(async () => (await getClientStrategies(page)).email.subSource, { timeout: 10_000 }).toBe(
      "generated_uuid",
    );
    await expect.poll(async () => (await getClientStrategies(page)).email.emailVerifiedMode, { timeout: 10_000 }).toBe(
      "user_choice",
    );

    await page.reload();
    await expect(page.getByTestId("strategy-username-subsource")).toHaveText("Generate UUID (stable per identity)");
    await expect(page.getByTestId("strategy-email-subsource")).toHaveText("Generate UUID (stable per identity)");
    await expect(page.getByTestId("strategy-email-verified-mode")).toHaveText("Allow QA to choose");
    await expect(page.getByTestId("strategy-email-enabled")).toBeChecked();

    const latestStrategies = await getClientStrategies(page);
    expect(latestStrategies).toMatchObject({
      username: { enabled: true, subSource: "generated_uuid" },
      email: { enabled: true, subSource: "generated_uuid", emailVerifiedMode: "user_choice" },
    });

    const username = `pw-user-${Date.now()}`;
    const usernameFlow = await runUsernameFlow({ tenantId, resourceId, clientId, username });
    expect(usernameFlow.idToken.sub).not.toBe(username);
    expect(usernameFlow.idToken.preferred_username).toBe(username);
    expect(usernameFlow.userinfo.sub).toBe(usernameFlow.idToken.sub);
    const usernameFlowRepeat = await runUsernameFlow({ tenantId, resourceId, clientId, username });
    expect(usernameFlowRepeat.idToken.sub).toBe(usernameFlow.idToken.sub);
    expect(usernameFlowRepeat.userinfo.sub).toBe(usernameFlow.userinfo.sub);

    const emailFlowVerified = await runEmailFlow({
      resourceId,
      clientId,
      email: "choice@example.test",
      emailVerifiedPreference: "true",
    });
    expect(emailFlowVerified.idToken.email_verified).toBe(true);
    expect(emailFlowVerified.userinfo.email_verified).toBe(true);

    const emailFlowUnverified = await runEmailFlow({
      resourceId,
      clientId,
      email: "choice@example.test",
      emailVerifiedPreference: "false",
    });
    expect(emailFlowUnverified.idToken.email_verified).toBe(false);
    expect(emailFlowUnverified.userinfo.email_verified).toBe(false);
    expect(emailFlowUnverified.idToken.sub).toBe(emailFlowVerified.idToken.sub);
    expect(emailFlowUnverified.userinfo.sub).toBe(emailFlowVerified.userinfo.sub);
  });
});

const updateSelect = async (page: Page, trigger: Locator, optionLabel: string) => {
  await trigger.click();
  await page.getByRole("option", { name: optionLabel }).click();
};

const selectTenant = async (page: Page, id: string) => {
  const switcher = page.getByTestId("tenant-switcher");
  await switcher.click();
  await page.getByTestId(`tenant-option-${id}`).click();
};

const runUsernameFlow = async ({
  tenantId,
  resourceId,
  clientId,
  username,
}: {
  tenantId: string;
  resourceId: string;
  clientId: string;
  username: string;
}): Promise<{ idToken: DecodedIdToken; userinfo: UserInfoClaims }> => {
  const jar = cookieJar();
  const verifier = randomPKCECodeVerifier();
  const challenge = await calculatePKCECodeChallenge(verifier);
  const state = randomState();
  const nonce = randomNonce();
  const authorizeUrl = buildAuthorizeUrl(resourceId, clientId, challenge, state, nonce);
  const authorizeResponse = await fetch(authorizeUrl, { redirect: "manual", headers: withSessionCookies(jar) });
  jar.addFrom(authorizeResponse);
  if (authorizeResponse.status !== 302) {
    throw new Error(`authorize_failed:${authorizeResponse.status}`);
  }
  const loginLocation = authorizeResponse.headers.get("location");
  if (!loginLocation) {
    throw new Error("missing_login_location");
  }
  const loginUrl = new URL(loginLocation, "http://127.0.0.1:3000");
  loginUrl.pathname = loginUrl.pathname.replace(/\/oidc\/login$/, "/oidc/login/submit");
  const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded" };
  const cookieHeader = jar.header();
  if (cookieHeader) {
    headers.cookie = cookieHeader;
  }
  const loginResponse = await fetch(loginUrl, {
    method: "POST",
    redirect: "manual",
    headers,
    body: new URLSearchParams({ strategy: "username", username, return_to: authorizeUrl }).toString(),
  });
  jar.addFrom(loginResponse);
  if (loginResponse.status !== 303) {
    throw new Error(`login_failed:${loginResponse.status}`);
  }
  const authorizeAfterLogin = await fetch(loginResponse.headers.get("location")!, {
    redirect: "manual",
    headers: withSessionCookies(jar),
  });
  if (authorizeAfterLogin.status !== 302) {
    throw new Error(`authorize_after_login_failed:${authorizeAfterLogin.status}`);
  }
  const callbackUrl = new URL(authorizeAfterLogin.headers.get("location")!);
  const code = callbackUrl.searchParams.get("code");
  if (!code) {
    throw new Error("missing_code");
  }
  const tokenResponse = await fetch(`http://127.0.0.1:3000/r/${resourceId}/oidc/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
      client_id: clientId,
      client_secret: clientSecret,
    }).toString(),
  });
  if (!tokenResponse.ok) {
    throw new Error(`token_failed:${tokenResponse.status}:${await tokenResponse.text()}`);
  }
  const payload = (await tokenResponse.json()) as { id_token: string; access_token: string };
  const idToken = decodeJwt(payload.id_token) as DecodedIdToken;
  const userinfo = await fetchUserInfoClaims(payload.access_token, resourceId);
  return { idToken, userinfo };
};

const setClientStrategies = async (page: Page, strategies: ClientAuthStrategies) => {
  const response = await page.request.post("/api/test/client-auth-strategies", {
    data: { tenantId, clientId, strategies },
  });
  if (!response.ok()) {
    throw new Error(`failed_to_set_strategies:${response.status()}`);
  }
};

const getClientStrategies = async (page: Page) => {
  const response = await page.request.get(`/api/test/client-auth-strategies?tenantId=${tenantId}&clientId=${clientId}`);
  if (!response.ok()) {
    throw new Error(`failed_to_get_strategies:${response.status()}`);
  }
  const payload = (await response.json()) as { strategies: ClientAuthStrategies };
  return payload.strategies;
};
