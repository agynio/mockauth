import { randomUUID } from "crypto";

import { SignJWT, importJWK } from "jose";

import type { AuthorizationCodeWithRelations } from "@/server/services/authorization-code-service";
import { prisma } from "@/server/db/client";
import { decrypt } from "@/server/crypto/key-vault";
import { verifySecret } from "@/server/crypto/hash";
import { computeS256Challenge } from "@/server/crypto/pkce";
import { DomainError } from "@/server/errors";
import { claimsForScopes } from "@/server/oidc/claims";
import { issuerForResource } from "@/server/oidc/issuer";
import { resolveRedirectUri } from "@/server/oidc/redirect-uri";
import { getActiveKey } from "@/server/services/key-service";
import { fromPrismaLoginStrategy, parseClientAuthStrategies } from "@/server/oidc/auth-strategy";

const ID_TOKEN_TTL_SECONDS = 600;
const ACCESS_TOKEN_TTL_SECONDS = 3600;

type CodeContext = AuthorizationCodeWithRelations;

const validateClientSecret = async (
  client: AuthorizationCodeWithRelations["client"],
  provided?: string | null,
) => {
  if (client.clientType === "PUBLIC") {
    if (client.tokenEndpointAuthMethod !== "none") {
      throw new DomainError("Public clients must use auth method none", { status: 400, code: "invalid_client" });
    }
    return;
  }

  if (!provided) {
    throw new DomainError("Client authentication required", { status: 401, code: "invalid_client" });
  }

  const valid = await verifySecret(provided, client.clientSecretHash);
  if (!valid) {
    throw new DomainError("Invalid client credentials", { status: 401, code: "invalid_client" });
  }
};

const verifyPkce = (code: CodeContext, verifier: string) => {
  if (code.codeChallengeMethod !== "S256") {
    throw new DomainError("Unsupported code challenge method", { status: 400, code: "invalid_grant" });
  }

  if (computeS256Challenge(verifier) !== code.codeChallenge) {
    throw new DomainError("Invalid code verifier", { status: 400, code: "invalid_grant" });
  }
};

export const issueTokensFromCode = async (params: {
  code: CodeContext;
  codeVerifier: string;
  redirectUri: string;
  clientSecret?: string | null;
  origin: string;
}) => {
  const { code, codeVerifier, redirectUri, clientSecret, origin } = params;

  const normalized = resolveRedirectUri(redirectUri, code.client.redirectUris ?? []);
  if (normalized !== code.redirectUri) {
    throw new DomainError("redirect_uri mismatch", { status: 400, code: "invalid_grant" });
  }
  await validateClientSecret(code.client, clientSecret);
  verifyPkce(code, codeVerifier);

  const activeKey = await getActiveKey(code.tenantId);
  const privateJwk = JSON.parse(decrypt(activeKey.privateJwkEncrypted));
  const signingKey = await importJWK(privateJwk, "RS256");

  const now = Math.floor(Date.now() / 1000);
  const issuer = issuerForResource(origin, code.apiResourceId);
  const scopes = code.scope.split(" ").filter(Boolean);
  const strategy = fromPrismaLoginStrategy(code.loginStrategy);
  const strategies = parseClientAuthStrategies(code.client.authStrategies);
  const emailVerifiedClaim =
    strategy === "email"
      ? strategies.email.emailVerifiedMode === "user_choice"
        ? Boolean(code.emailVerifiedOverride)
        : strategies.email.emailVerifiedMode === "true"
      : undefined;
  const idToken = await new SignJWT({
    ...claimsForScopes(code.user, scopes, strategy, { emailVerified: emailVerifiedClaim }),
    sub: code.subject,
    aud: code.client.clientId,
    iss: issuer,
    scope: code.scope,
    nonce: code.nonce,
  })
    .setProtectedHeader({ alg: "RS256", kid: activeKey.kid })
    .setIssuedAt(now)
    .setExpirationTime(now + ID_TOKEN_TTL_SECONDS)
    .sign(signingKey);

  const jti = randomUUID();
  const accessToken = await new SignJWT({
    ...claimsForScopes(code.user, scopes, strategy, { emailVerified: emailVerifiedClaim }),
    sub: code.subject,
    aud: code.client.clientId,
    iss: issuer,
    scope: code.scope,
    jti,
  })
    .setProtectedHeader({ alg: "RS256", kid: activeKey.kid })
    .setIssuedAt(now)
    .setExpirationTime(now + ACCESS_TOKEN_TTL_SECONDS)
    .sign(signingKey);

  await prisma.accessToken.create({
    data: {
      tenantId: code.tenantId,
      apiResourceId: code.apiResourceId,
      clientId: code.clientId,
      userId: code.userId,
      jti,
      scope: code.scope,
      expiresAt: new Date((now + ACCESS_TOKEN_TTL_SECONDS) * 1000),
    },
  });

  return {
    id_token: idToken,
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
  };
};
