import type { MockUser } from "@/generated/prisma/client";
import type { ClientAuthStrategy } from "@/server/oidc/auth-strategy";

export const claimsForScopes = (user: MockUser, scopes: string[], strategy: ClientAuthStrategy) => {
  const claims: Record<string, unknown> = {};
  if (scopes.includes("profile")) {
    claims.name = user.displayName ?? user.username;
    if (strategy === "username") {
      claims.preferred_username = user.username;
    }
  }

  if (strategy === "email" && scopes.includes("email") && user.email) {
    claims.email = user.email;
    claims.email_verified = false;
  }

  return claims;
};
