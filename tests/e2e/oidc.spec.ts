import { test, expect, type APIRequestContext } from "@playwright/test";
import { decodeJwt } from "jose";
import {
  allowInsecureRequests,
  authorizationCodeGrant,
  buildAuthorizationUrl,
  calculatePKCECodeChallenge,
  discovery,
  fetchUserInfo,
  randomNonce,
  randomPKCECodeVerifier,
  randomState,
  skipSubjectCheck,
} from "openid-client";

const defaultResourceId = "tenant_qa_default_resource";
const issuerBase = `http://127.0.0.1:3000/r/${defaultResourceId}/oidc`;
const redirectUri = "https://client.example.test/callback";
const refreshClientId = "qa-refresh-client";
const refreshClientSecret = "qa-refresh-secret";

const cookieJar = () => {
  const jar = new Map<string, string>();
  return {
    addFrom(response: Response) {
      // @ts-ignore Node 20 exposes getSetCookie
      const cookies: string[] = response.headers.getSetCookie?.() ?? [];
      for (const cookie of cookies) {
        const [pair] = cookie.split(";");
        const [name, value] = pair.split("=");
        jar.set(name, value);
      }
    },
    header() {
      return Array.from(jar.entries())
        .map(([name, value]) => `${name}=${value}`)
        .join("; ");
    },
  };
};

const withSessionCookies = (jar: ReturnType<typeof cookieJar>) => {
  const header = jar.header();
  return header ? { cookie: header } : undefined;
};

test("completes Authorization Code + PKCE flow", async () => {
  const config = await discovery(new URL(issuerBase), "qa-client", "qa-secret", undefined, {
    execute: [allowInsecureRequests],
  });

  const codeVerifier = randomPKCECodeVerifier();
  const codeChallenge = await calculatePKCECodeChallenge(codeVerifier);
  const state = randomState();
  const nonce = randomNonce();
  const authUrl = buildAuthorizationUrl(config, {
    scope: "openid profile email",
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    redirect_uri: redirectUri,
    state,
    nonce,
  }).toString();

  const jar = cookieJar();
  const authorizeResponse = await fetch(authUrl, { redirect: "manual" });
  jar.addFrom(authorizeResponse);
  expect(authorizeResponse.status).toBe(302);
  const loginLocation = authorizeResponse.headers.get("location");
  expect(loginLocation).toContain("/login");

  const loginUrl = new URL(loginLocation!, "http://127.0.0.1:3000");
  loginUrl.pathname = loginUrl.pathname.replace(/\/oidc\/login$/, "/oidc/login/submit");
  const loginResponse = await fetch(loginUrl, {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: jar.header(),
    },
    body: new URLSearchParams({ username: "e2e-user", return_to: authUrl }).toString(),
  });
  jar.addFrom(loginResponse);
  // @ts-ignore Node 20 exposes getSetCookie
  const loginCookies: string[] = loginResponse.headers.getSetCookie?.() ?? [];
  expect(
    loginCookies.some(
      (cookie) => cookie.includes("mockauth_enduser_session") && cookie.includes("Path=/r"),
    ),
  ).toBeTruthy();
  expect(loginResponse.status).toBe(303);
  const authorizeAgain = await fetch(loginResponse.headers.get("location")!, {
    redirect: "manual",
    headers: { cookie: jar.header() },
  });

  expect(authorizeAgain.status).toBe(302);
  const finalLocation = authorizeAgain.headers.get("location");
  expect(finalLocation).toContain("code=");
  const redirectParams = new URL(finalLocation!).searchParams;
  const params = { code: redirectParams.get("code")!, state: redirectParams.get("state")! };

  const callbackUrl = new URL(finalLocation!);
  const tokenSet = await authorizationCodeGrant(config, callbackUrl, {
    pkceCodeVerifier: codeVerifier,
    expectedState: state,
    expectedNonce: nonce,
  });
  expect(tokenSet.id_token).toBeTruthy();
  const userInfo = await fetchUserInfo(config, tokenSet.access_token!, skipSubjectCheck);
  expect(userInfo.sub).toBeDefined();
});

test("rotates refresh tokens for offline access", async () => {
  const config = await discovery(new URL(issuerBase), refreshClientId, refreshClientSecret, undefined, {
    execute: [allowInsecureRequests],
  });

  const codeVerifier = randomPKCECodeVerifier();
  const codeChallenge = await calculatePKCECodeChallenge(codeVerifier);
  const state = randomState();
  const nonce = randomNonce();
  const authUrl = buildAuthorizationUrl(config, {
    scope: "openid profile offline_access",
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    redirect_uri: redirectUri,
    state,
    nonce,
  }).toString();

  const jar = cookieJar();
  const authorizeResponse = await fetch(authUrl, { redirect: "manual" });
  jar.addFrom(authorizeResponse);
  expect(authorizeResponse.status).toBe(302);
  const loginLocation = authorizeResponse.headers.get("location");
  expect(loginLocation).toContain("/login");

  const loginUrl = new URL(loginLocation!, "http://127.0.0.1:3000");
  loginUrl.pathname = loginUrl.pathname.replace(/\/oidc\/login$/, "/oidc/login/submit");
  const loginResponse = await fetch(loginUrl, {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: jar.header(),
    },
    body: new URLSearchParams({ username: "e2e-refresh", return_to: authUrl }).toString(),
  });
  jar.addFrom(loginResponse);
  expect(loginResponse.status).toBe(303);
  const authorizeAgain = await fetch(loginResponse.headers.get("location")!, {
    redirect: "manual",
    headers: { cookie: jar.header() },
  });

  expect(authorizeAgain.status).toBe(302);
  const finalLocation = authorizeAgain.headers.get("location");
  expect(finalLocation).toContain("code=");
  const callbackUrl = new URL(finalLocation!);

  const tokenSet = await authorizationCodeGrant(config, callbackUrl, {
    pkceCodeVerifier: codeVerifier,
    expectedState: state,
    expectedNonce: nonce,
  });
  expect(tokenSet.refresh_token).toBeTruthy();

  const tokenEndpoint = config.serverMetadata().token_endpoint;
  if (!tokenEndpoint) {
    throw new Error("Missing token endpoint in discovery");
  }

  const refreshResponse = await fetch(tokenEndpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: tokenSet.refresh_token!,
      scope: "openid profile",
      client_id: refreshClientId,
      client_secret: refreshClientSecret,
    }).toString(),
  });
  expect(refreshResponse.ok).toBeTruthy();
  const refreshedPayload = (await refreshResponse.json()) as {
    access_token: string;
    refresh_token: string;
  };
  expect(refreshedPayload.refresh_token).toBeTruthy();
  expect(refreshedPayload.refresh_token).not.toBe(tokenSet.refresh_token);
  const refreshedAccess = decodeJwt(refreshedPayload.access_token);
  expect(refreshedAccess.scope).toBe("openid profile");

  const reusedResponse = await fetch(tokenEndpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: tokenSet.refresh_token!,
      client_id: refreshClientId,
      client_secret: refreshClientSecret,
    }).toString(),
  });
  expect(reusedResponse.status).toBe(400);
  const reusedPayload = (await reusedResponse.json()) as { error: string };
  expect(reusedPayload.error).toBe("invalid_grant");
});

test("requires login when session strategy disallows client", async ({ request }) => {
  const { tenantId, resourceId } = await seedTenantClients(request);
  const [emailClientId, usernameClientId] = await createClients(request, tenantId);

  await setClientStrategies(request, tenantId, emailClientId, {
    username: { enabled: false, subSource: "entered" },
    email: { enabled: true, subSource: "entered" },
  });

  await setClientStrategies(request, tenantId, usernameClientId, {
    username: { enabled: true, subSource: "entered" },
    email: { enabled: false, subSource: "entered" },
  });

  const jar = cookieJar();
  const firstVerifier = randomPKCECodeVerifier();
  const firstChallenge = await calculatePKCECodeChallenge(firstVerifier);
  const firstState = randomState();
  const firstNonce = randomNonce();
  const emailAuthUrl = buildAuthorizeUrl(resourceId, emailClientId, firstChallenge, firstState, firstNonce);

  const authorizeEmailClient = await fetch(emailAuthUrl, { redirect: "manual", headers: withSessionCookies(jar) });
  jar.addFrom(authorizeEmailClient);
  expect(authorizeEmailClient.status).toBe(302);
  const loginLocation = authorizeEmailClient.headers.get("location");
  expect(loginLocation).toContain("/login");

  const loginUrl = new URL(loginLocation!, "http://127.0.0.1:3000");
  loginUrl.pathname = loginUrl.pathname.replace(/\/oidc\/login$/, "/oidc/login/submit");
  const loginHeaders: Record<string, string> = {
    "content-type": "application/x-www-form-urlencoded",
  };
  const loginCookies = jar.header();
  if (loginCookies) {
    loginHeaders.cookie = loginCookies;
  }
  const loginResponse = await fetch(loginUrl, {
    method: "POST",
    redirect: "manual",
    headers: loginHeaders,
    body: new URLSearchParams({
      strategy: "email",
      email: "client-a@example.test",
      return_to: emailAuthUrl,
    }).toString(),
  });
  jar.addFrom(loginResponse);
  expect(loginResponse.status).toBe(303);

  const authorizeAfterLogin = await fetch(loginResponse.headers.get("location")!, {
    redirect: "manual",
    headers: withSessionCookies(jar),
  });
  expect(authorizeAfterLogin.status).toBe(302);

  const secondVerifier = randomPKCECodeVerifier();
  const secondChallenge = await calculatePKCECodeChallenge(secondVerifier);
  const secondState = randomState();
  const secondNonce = randomNonce();
  const usernameAuthUrl = buildAuthorizeUrl(resourceId, usernameClientId, secondChallenge, secondState, secondNonce);

  const authorizeUsernameClient = await fetch(usernameAuthUrl, {
    redirect: "manual",
    headers: withSessionCookies(jar),
  });
  expect(authorizeUsernameClient.status).toBe(302);
  expect(authorizeUsernameClient.headers.get("location")).toContain("/login");
});

test("email strategy mode false returns unverified claims", async ({ request }) => {
  const { tenantId, resourceId } = await seedTenantClients(request);
  const [clientId] = await createClients(request, tenantId);
  await setClientStrategies(request, tenantId, clientId, {
    username: { enabled: false, subSource: "entered" },
    email: { enabled: true, subSource: "entered", emailVerifiedMode: "false" },
  });
  const idToken = await runEmailFlow({
    resourceId,
    clientId,
    email: "mode-false@example.test",
  });
  expect(idToken.email_verified).toBe(false);
});

test("email strategy mode true returns verified claims", async ({ request }) => {
  const { tenantId, resourceId } = await seedTenantClients(request);
  const [clientId] = await createClients(request, tenantId);
  await setClientStrategies(request, tenantId, clientId, {
    username: { enabled: false, subSource: "entered" },
    email: { enabled: true, subSource: "entered", emailVerifiedMode: "true" },
  });
  const idToken = await runEmailFlow({
    resourceId,
    clientId,
    email: "mode-true@example.test",
  });
  expect(idToken.email_verified).toBe(true);
});

test("email strategy user choice honors selection", async ({ request }) => {
  const { tenantId, resourceId } = await seedTenantClients(request);
  const [clientId] = await createClients(request, tenantId);
  await setClientStrategies(request, tenantId, clientId, {
    username: { enabled: false, subSource: "entered" },
    email: { enabled: true, subSource: "entered", emailVerifiedMode: "user_choice" },
  });
  const verifiedToken = await runEmailFlow({
    resourceId,
    clientId,
    email: "choice@example.test",
    emailVerifiedPreference: "true",
  });
  expect(verifiedToken.email_verified).toBe(true);
  const unverifiedToken = await runEmailFlow({
    resourceId,
    clientId,
    email: "choice@example.test",
    emailVerifiedPreference: "false",
  });
  expect(unverifiedToken.email_verified).toBe(false);
});

const seedTenantClients = async (request: APIRequestContext) => {
  const response = await request.post("/admin/api/test/seed-tenants-clients", { data: {} });
  expect(response.ok()).toBeTruthy();
  const payload = (await response.json()) as { tenantAId: string; tenantAResourceId: string };
  return { tenantId: payload.tenantAId, resourceId: payload.tenantAResourceId };
};

const createClients = async (request: APIRequestContext, tenantId: string) => {
  const response = await request.post("/api/test/clients", {
    data: {
      tenantId,
      names: ["Email Strategy", "Username Strategy"],
      tokenEndpointAuthMethods: ["none"],
      redirectUris: [redirectUri],
    },
  });
  expect(response.ok()).toBeTruthy();
  const payload = (await response.json()) as { clients: { clientId: string }[] };
  if (payload.clients.length < 2) {
    throw new Error("Failed to seed clients for strategy test");
  }
  return [payload.clients[0]!.clientId, payload.clients[1]!.clientId] as const;
};

const setClientStrategies = async (
  request: APIRequestContext,
  tenantId: string,
  clientId: string,
  strategies: {
    username: { enabled: boolean; subSource: "entered" | "generated_uuid" };
    email: { enabled: boolean; subSource: "entered" | "generated_uuid"; emailVerifiedMode?: "true" | "false" | "user_choice" };
  },
) => {
  const response = await request.post("/api/test/client-auth-strategies", {
    data: {
      tenantId,
      clientId,
      strategies,
    },
  });
  expect(response.ok()).toBeTruthy();
};

const buildAuthorizeUrl = (
  resourceId: string,
  clientId: string,
  codeChallenge: string,
  state: string,
  nonce: string,
) => {
  const url = new URL(`http://127.0.0.1:3000/r/${resourceId}/oidc/authorize`);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid profile email");
  url.searchParams.set("state", state);
  url.searchParams.set("nonce", nonce);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
};

const runEmailFlow = async ({
  resourceId,
  clientId,
  email,
  emailVerifiedPreference,
}: {
  resourceId: string;
  clientId: string;
  email: string;
  emailVerifiedPreference?: "true" | "false";
}) => {
  const jar = cookieJar();
  const codeVerifier = randomPKCECodeVerifier();
  const codeChallenge = await calculatePKCECodeChallenge(codeVerifier);
  const state = randomState();
  const nonce = randomNonce();
  const authorizeUrl = buildAuthorizeUrl(resourceId, clientId, codeChallenge, state, nonce);
  const authorizeResponse = await fetch(authorizeUrl, { redirect: "manual", headers: withSessionCookies(jar) });
  jar.addFrom(authorizeResponse);
  expect(authorizeResponse.status).toBe(302);
  const loginLocation = authorizeResponse.headers.get("location");
  expect(loginLocation).toBeTruthy();
  const loginUrl = new URL(loginLocation!, "http://127.0.0.1:3000");
  loginUrl.pathname = loginUrl.pathname.replace(/\/oidc\/login$/, "/oidc/login/submit");
  const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded" };
  const cookieHeader = jar.header();
  if (cookieHeader) {
    headers.cookie = cookieHeader;
  }
  const loginBody = new URLSearchParams({ strategy: "email", email, return_to: authorizeUrl });
  if (emailVerifiedPreference) {
    loginBody.set("email_verified_preference", emailVerifiedPreference);
  }
  const loginResponse = await fetch(loginUrl, {
    method: "POST",
    redirect: "manual",
    headers,
    body: loginBody.toString(),
  });
  jar.addFrom(loginResponse);
  expect(loginResponse.status).toBe(303);
  const authorizeAfterLogin = await fetch(loginResponse.headers.get("location")!, {
    redirect: "manual",
    headers: withSessionCookies(jar),
  });
  expect(authorizeAfterLogin.status).toBe(302);
  const finalLocation = authorizeAfterLogin.headers.get("location");
  expect(finalLocation).toContain("code=");
  const callbackUrl = new URL(finalLocation!);
  const code = callbackUrl.searchParams.get("code");
  expect(code).toBeTruthy();
  const tokenResponse = await fetch(`http://127.0.0.1:3000/r/${resourceId}/oidc/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: code!,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
      client_id: clientId,
    }).toString(),
  });
  expect(tokenResponse.ok).toBeTruthy();
  const payload = (await tokenResponse.json()) as { id_token: string };
  expect(payload.id_token).toBeTruthy();
  return decodeJwt(payload.id_token);
};
