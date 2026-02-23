import { createHmac, timingSafeEqual } from "node:crypto";

import { env } from "@/server/env";

export const MOCK_REAUTH_COOKIE = "mockauth_reauth_ok" as const;
export const MOCK_FRESH_LOGIN_COOKIE = "mockauth_fresh_login" as const;
export const buildReauthCookiePath = (apiResourceId: string) => `/r/${apiResourceId}/oidc`;

const enum CookieVersion {
  REAUTH = "reauth-v1",
  FRESH_LOGIN = "fresh-v1",
}

type CookieClaims = {
  tenantId: string;
  apiResourceId: string;
  clientId: string;
  sessionHash: string;
  exp: number;
};

const encodePayload = (payload: CookieClaims) => Buffer.from(JSON.stringify(payload)).toString("base64url");
const decodePayload = (encoded: string): CookieClaims => JSON.parse(Buffer.from(encoded, "base64url").toString());

const sign = (encodedPayload: string) =>
  createHmac("sha256", env.NEXTAUTH_SECRET).update(encodedPayload).digest("base64url");

const createCookieValue = (
  version: CookieVersion,
  payload: Omit<CookieClaims, "exp">,
  ttlSeconds: number,
): string | null => {
  if (ttlSeconds <= 0) {
    return null;
  }
  const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
  const claims: CookieClaims = { ...payload, exp: expiresAt };
  const encoded = encodePayload(claims);
  const signature = sign(`${version}.${encoded}`);
  return `${version}.${encoded}.${signature}`;
};

const verifyCookieValue = (
  version: CookieVersion,
  value: string | undefined,
  expected: { tenantId: string; apiResourceId: string; clientId: string; sessionHash: string },
) => {
  if (!value) {
    return false;
  }
  const [providedVersion, encoded, providedSignature] = value.split(".");
  if (providedVersion !== version || !encoded || !providedSignature) {
    return false;
  }
  const expectedSignature = sign(`${version}.${encoded}`);
  const providedBuffer = Buffer.from(providedSignature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (providedBuffer.length !== expectedBuffer.length || !timingSafeEqual(providedBuffer, expectedBuffer)) {
    return false;
  }
  let payload: CookieClaims;
  try {
    payload = decodePayload(encoded);
  } catch {
    return false;
  }
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp <= now) {
    return false;
  }
  return (
    payload.tenantId === expected.tenantId &&
    payload.apiResourceId === expected.apiResourceId &&
    payload.clientId === expected.clientId &&
    payload.sessionHash === expected.sessionHash
  );
};

export const FRESH_LOGIN_COOKIE_TTL_SECONDS = 60;

export const createReauthCookieValue = (input: {
  tenantId: string;
  apiResourceId: string;
  clientId: string;
  sessionHash: string;
  ttlSeconds: number;
}) => {
  return createCookieValue(CookieVersion.REAUTH, input, input.ttlSeconds);
};

export const verifyReauthCookieValue = (
  value: string | undefined,
  expected: { tenantId: string; apiResourceId: string; clientId: string; sessionHash: string },
) => {
  return verifyCookieValue(CookieVersion.REAUTH, value, expected);
};

export const createFreshLoginCookieValue = (input: {
  tenantId: string;
  apiResourceId: string;
  clientId: string;
  sessionHash: string;
}) => {
  const value = createCookieValue(CookieVersion.FRESH_LOGIN, input, FRESH_LOGIN_COOKIE_TTL_SECONDS);
  if (!value) {
    throw new Error("Failed to create fresh-login cookie value");
  }
  return value;
};

export const verifyFreshLoginCookieValue = (
  value: string | undefined,
  expected: { tenantId: string; apiResourceId: string; clientId: string; sessionHash: string },
) => verifyCookieValue(CookieVersion.FRESH_LOGIN, value, expected);
