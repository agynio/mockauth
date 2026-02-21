import { decodeJwt, type JWTPayload } from "jose";
import { calculatePKCECodeChallenge, randomNonce, randomPKCECodeVerifier, randomState } from "openid-client";

export const redirectUri = "https://client.example.test/callback";
const clientSecret = "qa-secret";

export const cookieJar = () => {
  const jar = new Map<string, string>();
  return {
    addFrom(response: Response) {
      const cookies: string[] = (response.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
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

export const withSessionCookies = (jar: ReturnType<typeof cookieJar>) => {
  const header = jar.header();
  return header ? { cookie: header } : undefined;
};

export const buildAuthorizeUrl = (
  tenantId: string,
  resourceId: string,
  clientId: string,
  codeChallenge: string,
  state: string,
  nonce: string,
) => {
  const url = new URL(`http://127.0.0.1:3000/t/${tenantId}/r/${resourceId}/oidc/authorize`);
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

type RunEmailFlowOptions = {
  tenantId: string;
  resourceId: string;
  clientId: string;
  email: string;
  emailVerifiedPreference?: "true" | "false";
};

export type DecodedIdToken = JWTPayload & { email?: string; email_verified?: boolean; preferred_username?: string };
export type UserInfoClaims = {
  sub: string;
  email?: string;
  email_verified?: boolean;
  preferred_username?: string;
};

export const runEmailFlow = async ({ tenantId, resourceId, clientId, email, emailVerifiedPreference }: RunEmailFlowOptions) => {
  const jar = cookieJar();
  const codeVerifier = randomPKCECodeVerifier();
  const codeChallenge = await calculatePKCECodeChallenge(codeVerifier);
  const state = randomState();
  const nonce = randomNonce();
  const authorizeUrl = buildAuthorizeUrl(tenantId, resourceId, clientId, codeChallenge, state, nonce);
  const authorizeResponse = await fetch(authorizeUrl, { redirect: "manual", headers: withSessionCookies(jar) });
  jar.addFrom(authorizeResponse);
  if (authorizeResponse.status !== 302) {
    throw new Error(`authorize_response_unexpected_status:${authorizeResponse.status}`);
  }
  const loginLocation = authorizeResponse.headers.get("location");
  if (!loginLocation) {
    throw new Error("authorize_missing_login_redirect");
  }
  const loginUrl = new URL(loginLocation, "http://127.0.0.1:3000");
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
  if (loginResponse.status !== 303) {
    throw new Error(`login_response_unexpected_status:${loginResponse.status}`);
  }
  const authorizeAfterLogin = await fetch(loginResponse.headers.get("location")!, {
    redirect: "manual",
    headers: withSessionCookies(jar),
  });
  if (authorizeAfterLogin.status !== 302) {
    throw new Error(`authorize_after_login_unexpected_status:${authorizeAfterLogin.status}`);
  }
  const finalLocation = authorizeAfterLogin.headers.get("location");
  if (!finalLocation) {
    throw new Error("authorize_after_login_missing_location");
  }
  const callbackUrl = new URL(finalLocation);
  const code = callbackUrl.searchParams.get("code");
  if (!code) {
    throw new Error("authorization_code_missing");
  }
  const tokenResponse = await fetch(`http://127.0.0.1:3000/t/${tenantId}/r/${resourceId}/oidc/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
      client_id: clientId,
      client_secret: clientSecret,
    }).toString(),
  });
  if (!tokenResponse.ok) {
    throw new Error(`token_response_failed:${tokenResponse.status}:${await tokenResponse.text()}`);
  }
  const payload = (await tokenResponse.json()) as { id_token: string; access_token: string };
  if (!payload.id_token || !payload.access_token) {
    throw new Error("token_response_missing_tokens");
  }
  const idToken = decodeJwt(payload.id_token) as DecodedIdToken;
  const userinfo = await fetchUserInfoClaims(payload.access_token, tenantId, resourceId);
  return { idToken, userinfo };
};

export const fetchUserInfoClaims = async (accessToken: string, tenantId: string, resourceId: string): Promise<UserInfoClaims> => {
  const response = await fetch(`http://127.0.0.1:3000/t/${tenantId}/r/${resourceId}/oidc/userinfo`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw new Error(`userinfo_failed:${response.status}`);
  }
  return (await response.json()) as UserInfoClaims;
};
