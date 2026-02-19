import { decodeJwt, decodeProtectedHeader, importJWK, jwtVerify } from "jose";

import { prisma } from "@/server/db/client";
import { DomainError } from "@/server/errors";
import { claimsForScopes } from "@/server/oidc/claims";
import { issuerForResource, legacyTenantIssuer, parseIssuerSegments } from "@/server/oidc/issuer";
import { getPublicJwkByKid } from "@/server/services/key-service";
import { getActiveTenantById } from "@/server/services/tenant-service";

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
  expectedTenantId: string,
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

  if (issuerContext.tenantId !== expectedTenantId) {
    throw new DomainError("Invalid issuer", { status: 400, code: "invalid_token" });
  }
  const tenant = await getActiveTenantById(issuerContext.tenantId);

  const header = decodeProtectedHeader(token);
  if (!header.kid) {
    throw new DomainError("Missing key id", { status: 400, code: "invalid_token" });
  }

  const keyJwk = await getPublicJwkByKid(tenant.id, header.kid);
  const key = await importJWK(keyJwk, "RS256");
  let expectedIssuer: string;
  if (issuerContext.isLegacy) {
    if (tenant.defaultApiResourceId !== expectedApiResourceId) {
      throw new DomainError("Invalid issuer", { status: 400, code: "invalid_token" });
    }
    expectedIssuer = legacyTenantIssuer(origin, tenant.id);
  } else {
    if (issuerContext.apiResourceId !== expectedApiResourceId) {
      throw new DomainError("Invalid issuer", { status: 400, code: "invalid_token" });
    }
    expectedIssuer = issuerForResource(origin, tenant.id, issuerContext.apiResourceId);
  }
  const { payload } = await jwtVerify(token, key, { issuer: expectedIssuer });

  const user = await prisma.mockUser.findUnique({ where: { id: payload.sub as string } });
  if (!user) {
    throw new DomainError("Unknown user", { status: 400, code: "invalid_token" });
  }

  const scopes = (payload.scope as string | undefined)?.split(" ").filter(Boolean) ?? [];
  return {
    sub: user.id,
    ...claimsForScopes(user, scopes),
  };
};
