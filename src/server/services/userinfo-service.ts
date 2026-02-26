import { decodeJwt, decodeProtectedHeader, importJWK, jwtVerify } from "jose";

import { DomainError } from "@/server/errors";
import { issuerForResource, parseIssuerSegments } from "@/server/oidc/issuer";
import { getPublicJwkByKid } from "@/server/services/key-service";
import { getApiResourceWithTenant } from "@/server/services/api-resource-service";
import { isJwtSigningAlg } from "@/server/oidc/signing-alg";

const parseBearer = (header?: string | null) => {
  if (!header) {
    throw new DomainError("Missing Authorization header", { status: 401, code: "invalid_token" });
  }

  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) {
    throw new DomainError("Invalid Authorization header", { status: 401, code: "invalid_token" });
  }

  return token;
};

export const getUserInfo = async (
  authHeader: string | null | undefined,
  origin: string,
  expectedApiResourceId: string,
) => {
  const token = parseBearer(authHeader ?? undefined);
  const decoded = decodeJwt(token);
  if (!decoded.iss) {
    throw new DomainError("Token missing issuer", { status: 400, code: "invalid_token" });
  }

  let issuerContext;
  try {
    issuerContext = parseIssuerSegments(decoded.iss);
  } catch {
    throw new DomainError("Invalid issuer", { status: 400, code: "invalid_token" });
  }

  if (issuerContext.apiResourceId !== expectedApiResourceId) {
    throw new DomainError("Invalid issuer", { status: 400, code: "invalid_token" });
  }
  const { tenant } = await getApiResourceWithTenant(expectedApiResourceId);

  const header = decodeProtectedHeader(token);
  if (!header.kid) {
    throw new DomainError("Missing key id", { status: 400, code: "invalid_token" });
  }
  if (!header.alg || !isJwtSigningAlg(header.alg)) {
    throw new DomainError("Unsupported signing algorithm", { status: 400, code: "invalid_token" });
  }

  const keyJwk = await getPublicJwkByKid(tenant.id, header.kid);
  const key = await importJWK(keyJwk, header.alg);
  const expectedIssuer = issuerForResource(origin, expectedApiResourceId);
  const { payload } = await jwtVerify(token, key, { issuer: expectedIssuer, algorithms: [header.alg] });
  const claims: Record<string, unknown> = { sub: payload.sub };
  if (typeof payload.name === "string") {
    claims.name = payload.name;
  }
  if (typeof payload.preferred_username === "string") {
    claims.preferred_username = payload.preferred_username;
  }
  if (typeof payload.email === "string") {
    claims.email = payload.email;
    if (typeof payload.email_verified === "boolean") {
      claims.email_verified = payload.email_verified;
    }
  }

  return claims;
};
