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
import { emitAuditEvent } from "@/server/services/audit-service";
import {
  buildTokenAuthCodeReceivedDetails,
  summarizeTokenResponse,
  type TokenAuthMethod,
  type TokenResponsePayload,
} from "@/server/services/audit-event";
import {
  createSecurityViolationReporter,
  SecurityViolationError,
  withSecurityViolationAudit,
} from "@/server/services/security-violation";
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
  authMethod?: TokenAuthMethod;
  clientSecretInBody?: boolean;
  clientIdProvided?: boolean;
};

export const assertClientSecret = async (client: ClientSecretContext, provided?: string | null) => {
  if (client.clientType === "PUBLIC") {
    if (client.tokenEndpointAuthMethod !== "none") {
      throw new SecurityViolationError(
        "Public clients must use auth method none",
        { status: 400, code: "invalid_client" },
        "auth_method_mismatch",
      );
    }
    return;
  }

  if (!provided) {
    throw new SecurityViolationError(
      "Client authentication required",
      { status: 401, code: "invalid_client" },
      "client_auth_missing",
    );
  }

  const valid = await verifySecret(provided, client.clientSecretHash);
  if (!valid) {
    throw new SecurityViolationError(
      "Invalid client credentials",
      { status: 401, code: "invalid_client" },
      "client_auth_invalid",
    );
  }
};

type PkceContext = {
  codeChallengeMethod: string;
  codeChallenge: string;
};

export const verifyPkce = (code: PkceContext, verifier: string) => {
  if (code.codeChallengeMethod !== "S256") {
    throw new SecurityViolationError(
      "Unsupported code challenge method",
      { status: 400, code: "invalid_grant" },
      "pkce_method_unsupported",
    );
  }

  if (computeS256Challenge(verifier) !== code.codeChallenge) {
    throw new SecurityViolationError(
      "Invalid code verifier",
      { status: 400, code: "invalid_grant" },
      "pkce_mismatch",
    );
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
  const violationContext = {
    tenantId: code.tenantId,
    clientId: code.clientId,
    traceId,
    authMethod,
    clientSecretInBody: auditContext?.clientSecretInBody,
    requestContext: auditContext?.requestContext ?? null,
  };
  const reportViolation = createSecurityViolationReporter(violationContext);

  void emitAuditEvent({
    tenantId: code.tenantId,
    clientId: code.clientId,
    traceId,
    actorId: null,
    eventType: "TOKEN_AUTHCODE_RECEIVED",
    severity: "INFO",
    message: "Token request received",
    details: buildTokenAuthCodeReceivedDetails({
      authMethod,
      clientSecretInBody: auditContext?.clientSecretInBody,
      clientIdProvided: auditContext?.clientIdProvided,
    }),
    requestContext: auditContext?.requestContext ?? null,
  });

  const normalized = resolveRedirectUri(redirectUri, code.client.redirectUris ?? []);
  if (normalized !== code.redirectUri) {
    await reportViolation("redirect_uri_mismatch", "redirect_uri mismatch");
    throw new DomainError("redirect_uri mismatch", { status: 400, code: "invalid_grant" });
  }
  await withSecurityViolationAudit(() => assertClientSecret(code.client, clientSecret), violationContext);
  await withSecurityViolationAudit(async () => verifyPkce(code, codeVerifier), violationContext);

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

  const response: TokenResponsePayload = {
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
    details: summarizeTokenResponse(response),
    requestContext: auditContext?.requestContext ?? null,
  });

  return response;
};
