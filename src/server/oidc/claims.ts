import type { MockUser } from "@/generated/prisma/client";

export const claimsForScopes = (user: MockUser, scopes: string[]) => {
  const claims: Record<string, unknown> = {};
  if (scopes.includes("profile")) {
    claims.name = user.displayName ?? user.username;
    claims.preferred_username = user.username;
  }

  if (scopes.includes("email") && user.email) {
    claims.email = user.email;
    claims.email_verified = true;
  }

  return claims;
};
