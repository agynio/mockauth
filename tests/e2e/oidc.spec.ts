import { test, expect } from "@playwright/test";
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

const tenantId = "tenant_qa";
const defaultResourceId = "tenant_qa_default_resource";
const issuerBase = `http://127.0.0.1:3000/t/${tenantId}/r/${defaultResourceId}/oidc`;
const redirectUri = "https://client.example.test/callback";

const cookieJar = () => {
  const jar = new Map<string, string>();
  return {
    addFrom(response: Response) {
      // @ts-ignore node 20 exposes getSetCookie
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

test("legacy slug discovery responds with guidance", async () => {
  const response = await fetch("http://127.0.0.1:3000/t/qa/oidc/.well-known/openid-configuration");
  expect(response.status).toBe(410);
  const payload = await response.json();
  expect(payload.error).toBe("tenant_id_required");
  expect(payload.adminUrl).toContain("/admin/clients");
});
