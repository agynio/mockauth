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
import { ensureActiveKeyForAlg } from "@/server/services/key-service";
import { fromPrismaLoginStrategy, parseClientAuthStrategies } from "@/server/oidc/auth-strategy";
import { DEFAULT_JWT_SIGNING_ALG } from "@/server/oidc/signing-alg";
import { emitAuditEvent, recordSecurityViolation } from "@/server/services/audit-service";
import type { JwtSigningAlg } from "@/generated/prisma/client";
import type { RequestContext } from "@/server/utils/request-context";

const ID_TOKEN_TTL_SECONDS = 600;
const ACCESS_TOKEN_TTL_SECONDS = 3600;

type CodeContext = AuthorizationCodeWithRelations;

type ClientSecretContext = {
  clientType: AuthorizationCodeWithRelations["client"]["clientType"];
  tokenEndpointAuthMethod: AuthorizationCodeWithRelations["client"]["tokenEndpointAuthMethod"];
  clientSecretHash: AuthorizationCodeWithRelations["client"]["clientSecretHash"];
};

type TokenAuditContext = {
  requestContext?: RequestContext | null;
  authMethod?: "client_secret_basic" | "client_secret_post" | "none";
  clientSecretInBody?: boolean;
  clientIdProvided?: boolean;
};

export const assertClientSecret = async (client: ClientSecretContext, provided?: string | null) => {
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

type PkceContext = {
  codeChallengeMethod: string;
  codeChallenge: string;
};

export const verifyPkce = (code: PkceContext, verifier: string) => {
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
  auditContext?: TokenAuditContext | null;
}) => {
  const { code, codeVerifier, redirectUri, clientSecret, origin, auditContext } = params;
  const traceId = code.traceId ?? null;
  const authMethod = auditContext?.authMethod ?? code.client.tokenEndpointAuthMethod;

  void emitAuditEvent({
    tenantId: code.tenantId,
    clientId: code.clientId,
    traceId,
    actorId: null,
    eventType: "TOKEN_AUTHCODE_RECEIVED",
    severity: "INFO",
    message: "Token request received",
    details: {
      authMethod,
      clientSecretInBody: auditContext?.clientSecretInBody,
      clientIdProvided: auditContext?.clientIdProvided,
    },
    requestContext: auditContext?.requestContext ?? null,
  });

  const normalized = resolveRedirectUri(redirectUri, code.client.redirectUris ?? []);
  if (normalized !== code.redirectUri) {
    void recordSecurityViolation({
      tenantId: code.tenantId,
      clientId: code.clientId,
      traceId,
      reason: "redirect_uri_mismatch",
      authMethod,
      clientSecretInBody: auditContext?.clientSecretInBody,
      requestContext: auditContext?.requestContext ?? null,
      message: "redirect_uri mismatch",
    });
    throw new DomainError("redirect_uri mismatch", { status: 400, code: "invalid_grant" });
  }
  try {
    await assertClientSecret(code.client, clientSecret);
  } catch (error) {
    if (error instanceof DomainError) {
      const reason = error.message.includes("Client authentication required")
        ? "client_auth_missing"
        : error.message.includes("Invalid client credentials")
          ? "client_auth_invalid"
          : "auth_method_mismatch";
      void recordSecurityViolation({
        tenantId: code.tenantId,
        clientId: code.clientId,
        traceId,
        reason,
        authMethod,
        clientSecretInBody: auditContext?.clientSecretInBody,
        requestContext: auditContext?.requestContext ?? null,
      });
    }
    throw error;
  }

  try {
    verifyPkce(code, codeVerifier);
  } catch (error) {
    if (error instanceof DomainError) {
      const reason = error.message.includes("Invalid code verifier") ? "pkce_mismatch" : "pkce_method_unsupported";
      void recordSecurityViolation({
        tenantId: code.tenantId,
        clientId: code.clientId,
        traceId,
        reason,
        authMethod,
        clientSecretInBody: auditContext?.clientSecretInBody,
        requestContext: auditContext?.requestContext ?? null,
      });
    }
    throw error;
  }

  const idTokenAlg: JwtSigningAlg = code.client.idTokenSignedResponseAlg ?? DEFAULT_JWT_SIGNING_ALG;
  const accessTokenAlg: JwtSigningAlg = code.client.accessTokenSigningAlg ?? idTokenAlg;

  const requiredAlgs = Array.from(new Set<JwtSigningAlg>([idTokenAlg, accessTokenAlg]));
  type ImportedKey = Awaited<ReturnType<typeof importJWK>>;
  const signingKeys = new Map<JwtSigningAlg, { keyId: string; cryptoKey: ImportedKey }>();

  for (const alg of requiredAlgs) {
    const activeKey = await ensureActiveKeyForAlg(code.tenantId, alg);
    const privateJwk = JSON.parse(decrypt(activeKey.privateJwkEncrypted));
    const cryptoKey = await importJWK(privateJwk, alg);
    signingKeys.set(alg, { keyId: activeKey.kid, cryptoKey });
  }

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
  const idTokenKey = signingKeys.get(idTokenAlg);
  if (!idTokenKey) {
    throw new DomainError("Missing signing key for id_token", { status: 500 });
  }

  const idToken = await new SignJWT({
    ...claimsForScopes(code.user, scopes, strategy, { emailVerified: emailVerifiedClaim }),
    sub: code.subject,
    aud: code.client.clientId,
    iss: issuer,
    scope: code.scope,
    nonce: code.nonce,
  })
    .setProtectedHeader({ alg: idTokenAlg, kid: idTokenKey.keyId })
    .setIssuedAt(now)
    .setExpirationTime(now + ID_TOKEN_TTL_SECONDS)
    .sign(idTokenKey.cryptoKey);

  const jti = randomUUID();
  const accessTokenKey = signingKeys.get(accessTokenAlg);
  if (!accessTokenKey) {
    throw new DomainError("Missing signing key for access_token", { status: 500 });
  }

  const accessToken = await new SignJWT({
    ...claimsForScopes(code.user, scopes, strategy, { emailVerified: emailVerifiedClaim }),
    sub: code.subject,
    aud: code.client.clientId,
    iss: issuer,
    scope: code.scope,
    jti,
  })
    .setProtectedHeader({ alg: accessTokenAlg, kid: accessTokenKey.keyId })
    .setIssuedAt(now)
    .setExpirationTime(now + ACCESS_TOKEN_TTL_SECONDS)
    .sign(accessTokenKey.cryptoKey);

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

  const response = {
    id_token: idToken,
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
  };

  void emitAuditEvent({
    tenantId: code.tenantId,
    clientId: code.clientId,
    traceId,
    actorId: null,
    eventType: "TOKEN_AUTHCODE_COMPLETED",
    severity: "INFO",
    message: "Token response issued",
    details: response,
    requestContext: auditContext?.requestContext ?? null,
  });

  return response;
};
