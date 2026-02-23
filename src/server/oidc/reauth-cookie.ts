import { createHmac, timingSafeEqual } from "node:crypto";

import { env } from "@/server/env";

export const MOCK_REAUTH_COOKIE = "mockauth_reauth_ok" as const;
export const buildReauthCookiePath = (apiResourceId: string) => `/r/${apiResourceId}/oidc`;

const VERSION = "v1" as const;

type ReauthClaims = {
  tenantId: string;
  apiResourceId: string;
  clientId: string;
  sessionHash: string;
  exp: number;
};

const encodePayload = (payload: ReauthClaims) => Buffer.from(JSON.stringify(payload)).toString("base64url");
const decodePayload = (encoded: string): ReauthClaims => JSON.parse(Buffer.from(encoded, "base64url").toString());

const sign = (encodedPayload: string) =>
  createHmac("sha256", env.NEXTAUTH_SECRET).update(encodedPayload).digest("base64url");

export const createReauthCookieValue = (input: {
  tenantId: string;
  apiResourceId: string;
  clientId: string;
  sessionHash: string;
  ttlSeconds: number;
}) => {
  if (input.ttlSeconds <= 0) {
    return null;
  }
  const expiresAt = Math.floor(Date.now() / 1000) + input.ttlSeconds;
  const payload: ReauthClaims = {
    tenantId: input.tenantId,
    apiResourceId: input.apiResourceId,
    clientId: input.clientId,
    sessionHash: input.sessionHash,
    exp: expiresAt,
  };
  const encoded = encodePayload(payload);
  const signature = sign(encoded);
  return `${VERSION}.${encoded}.${signature}`;
};

export const verifyReauthCookieValue = (
  value: string | undefined,
  expected: { tenantId: string; apiResourceId: string; clientId: string; sessionHash: string },
) => {
  if (!value) {
    return false;
  }
  const [version, encoded, providedSignature] = value.split(".");
  if (version !== VERSION || !encoded || !providedSignature) {
    return false;
  }
  const expectedSignature = sign(encoded);
  const providedBuffer = Buffer.from(providedSignature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (providedBuffer.length !== expectedBuffer.length || !timingSafeEqual(providedBuffer, expectedBuffer)) {
    return false;
  }
  let payload: ReauthClaims;
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
