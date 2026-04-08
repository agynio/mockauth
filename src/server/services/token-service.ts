import { randomUUID } from "crypto";

import { SignJWT, decodeProtectedHeader, importJWK, jwtVerify } from "jose";

import type { AuthorizationCodeWithRelations } from "@/server/services/authorization-code-service";
import { prisma } from "@/server/db/client";
import { decrypt } from "@/server/crypto/key-vault";
import { verifySecret } from "@/server/crypto/hash";
import { computeS256Challenge } from "@/server/crypto/pkce";
import { DomainError } from "@/server/errors";
import { claimsForScopes } from "@/server/oidc/claims";
import { issuerForResource } from "@/server/oidc/issuer";
import { resolveRedirectUri } from "@/server/oidc/redirect-uri";
import { ensureActiveKeyForAlg, getPublicJwkByKid } from "@/server/services/key-service";
import type { ClientAuthStrategy } from "@/server/oidc/auth-strategy";
import { fromPrismaLoginStrategy, parseClientAuthStrategies } from "@/server/oidc/auth-strategy";
import { normalizeScopes } from "@/server/oidc/scopes";
import { parseTokenAuthMethods, type TokenAuthMethod } from "@/server/oidc/token-auth-method";
import { DEFAULT_JWT_SIGNING_ALG, isJwtSigningAlg } from "@/server/oidc/signing-alg";
import { emitAuditEvent } from "@/server/services/audit-service";
import {
  buildTokenAuthCodeReceivedDetails,
  buildTokenRefreshReceivedDetails,
  type TokenResponsePayload,
} from "@/server/services/audit-event";
import { getApiResourceWithTenant } from "@/server/services/api-resource-service";
import { getClientForTenant } from "@/server/services/client-service";
import { resolveStableSubject } from "@/server/services/mock-identity-service";
import { findOrCreateMockUser } from "@/server/services/mock-user-service";
import {
  createSecurityViolationReporter,
  SecurityViolationError,
  withSecurityViolationAudit,
} from "@/server/services/security-violation";
import type { JwtSigningAlg, MockUser } from "@/generated/prisma/client";
import type { RequestContext } from "@/server/utils/request-context";

const ID_TOKEN_TTL_SECONDS = 600;
const ACCESS_TOKEN_TTL_SECONDS = 3600;
const REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;
type CodeContext = AuthorizationCodeWithRelations;

type ClientAuthContext = {
  tokenEndpointAuthMethods: string[];
  clientSecretHash: string | null;
};

type TokenAuditContext = {
  requestContext?: RequestContext | null;
  authMethod?: TokenAuthMethod;
  clientSecretInBody?: boolean;
  clientIdProvided?: boolean;
  clientId?: string;
  includeAuthHeader?: boolean;
};

export const assertClientAuth = async (
  client: ClientAuthContext,
  authMethod: TokenAuthMethod,
  provided?: string | null,
) => {
  const allowedMethods = parseTokenAuthMethods(client.tokenEndpointAuthMethods);
  if (!allowedMethods.includes(authMethod)) {
    throw new SecurityViolationError(
      "Client authentication method not allowed",
      { status: 401, code: "invalid_client" },
      "auth_method_mismatch",
      {
        expectedAuthMethod: allowedMethods.length === 1 ? allowedMethods[0] : undefined,
        receivedAuthMethod: authMethod,
      },
    );
  }

  if (authMethod === "none") {
    return;
  }

  if (!provided) {
    throw new SecurityViolationError(
      "Client authentication required",
      { status: 401, code: "invalid_client" },
      "client_auth_missing",
      { clientSecret: null },
    );
  }

  if (!client.clientSecretHash) {
    throw new DomainError("Client secret missing", { status: 500 });
  }

  const valid = await verifySecret(provided, client.clientSecretHash);
  if (!valid) {
    throw new SecurityViolationError(
      "Invalid client credentials",
      { status: 401, code: "invalid_client" },
      "client_auth_invalid",
      { clientSecret: provided },
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
      {
        expectedCodeChallengeMethod: "S256",
        receivedCodeChallengeMethod: code.codeChallengeMethod,
      },
    );
  }

  if (computeS256Challenge(verifier) !== code.codeChallenge) {
    throw new SecurityViolationError(
      "Invalid code verifier",
      { status: 400, code: "invalid_grant" },
      "pkce_mismatch",
      {
        expectedCodeChallenge: code.codeChallenge,
        receivedCodeVerifier: verifier,
      },
    );
  }
};

const assertPkce = (code: PkceContext, verifier?: string | null) => {
  if (!verifier) {
    throw new SecurityViolationError(
      "Code verifier required",
      { status: 400, code: "invalid_grant" },
      "pkce_mismatch",
      {
        expectedCodeChallenge: code.codeChallenge,
        receivedCodeVerifier: verifier ?? undefined,
      },
    );
  }

  verifyPkce(code, verifier);
};

const normalizeRequestedScopes = (scope: string, allowedScopes: string[]) => {
  const requested = normalizeScopes(scope.split(" ").filter(Boolean));
  if (requested.length === 0) {
    throw new DomainError("scope is required", { status: 400, code: "invalid_scope" });
  }
  if (!requested.includes("openid")) {
    throw new DomainError("scope must include openid", { status: 400, code: "invalid_scope" });
  }
  const allowed = new Set(normalizeScopes(allowedScopes));
  const notAllowed = requested.filter((value) => !allowed.has(value));
  if (notAllowed.length > 0) {
    throw new DomainError(`Client does not allow scopes: ${notAllowed.join(", ")}`, {
      status: 400,
      code: "invalid_scope",
    });
  }
  return requested;
};

type TokenIssueContext = {
  tenantId: string;
  apiResourceId: string;
  client: {
    id: string;
    clientId: string;
    idTokenSignedResponseAlg: JwtSigningAlg | null;
    accessTokenSigningAlg: JwtSigningAlg | null;
    allowedGrantTypes: string[];
    allowedScopes: string[];
  };
  user: MockUser;
  subject: string;
  scope: string;
  origin: string;
  strategy: ClientAuthStrategy;
  emailVerifiedClaim?: boolean;
  nonce?: string | null;
};

const issueTokens = async (params: TokenIssueContext): Promise<TokenResponsePayload> => {
  const idTokenAlg: JwtSigningAlg = params.client.idTokenSignedResponseAlg ?? DEFAULT_JWT_SIGNING_ALG;
  const accessTokenAlg: JwtSigningAlg = params.client.accessTokenSigningAlg ?? idTokenAlg;

  const requiredAlgs = Array.from(new Set<JwtSigningAlg>([idTokenAlg, accessTokenAlg]));
  type ImportedKey = Awaited<ReturnType<typeof importJWK>>;
  const signingKeys = new Map<JwtSigningAlg, { keyId: string; cryptoKey: ImportedKey }>();

  for (const alg of requiredAlgs) {
    const activeKey = await ensureActiveKeyForAlg(params.tenantId, alg);
    const privateJwk = JSON.parse(decrypt(activeKey.privateJwkEncrypted));
    const cryptoKey = await importJWK(privateJwk, alg);
    signingKeys.set(alg, { keyId: activeKey.kid, cryptoKey });
  }

  const now = Math.floor(Date.now() / 1000);
  const issuer = issuerForResource(params.origin, params.apiResourceId);
  const scopes = params.scope.split(" ").filter(Boolean);
  const shouldIssueRefreshToken =
    params.client.allowedGrantTypes.includes("refresh_token") && scopes.includes("offline_access");
  const idTokenKey = signingKeys.get(idTokenAlg);
  if (!idTokenKey) {
    throw new DomainError("Missing signing key for id_token", { status: 500 });
  }

  const idToken = await new SignJWT({
    ...claimsForScopes(params.user, scopes, params.strategy, { emailVerified: params.emailVerifiedClaim }),
    sub: params.subject,
    aud: params.client.clientId,
    iss: issuer,
    scope: params.scope,
    nonce: params.nonce,
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
    ...claimsForScopes(params.user, scopes, params.strategy, { emailVerified: params.emailVerifiedClaim }),
    sub: params.subject,
    aud: params.client.clientId,
    iss: issuer,
    scope: params.scope,
    jti,
  })
    .setProtectedHeader({ alg: accessTokenAlg, kid: accessTokenKey.keyId })
    .setIssuedAt(now)
    .setExpirationTime(now + ACCESS_TOKEN_TTL_SECONDS)
    .sign(accessTokenKey.cryptoKey);

  await prisma.accessToken.create({
    data: {
      tenantId: params.tenantId,
      apiResourceId: params.apiResourceId,
      clientId: params.client.id,
      userId: params.user.id,
      jti,
      scope: params.scope,
      expiresAt: new Date((now + ACCESS_TOKEN_TTL_SECONDS) * 1000),
    },
  });

  let refreshToken: string | undefined;
  if (shouldIssueRefreshToken) {
    const refreshTokenId = randomUUID();
    const refreshClaims: Record<string, unknown> = {
      sub: params.subject,
      aud: params.client.clientId,
      iss: issuer,
      scope: params.scope,
      jti: refreshTokenId,
      uid: params.user.id,
      strategy: params.strategy,
    };
    if (typeof params.emailVerifiedClaim === "boolean") {
      refreshClaims.email_verified = params.emailVerifiedClaim;
    }

    refreshToken = await new SignJWT(refreshClaims)
      .setProtectedHeader({ alg: accessTokenAlg, kid: accessTokenKey.keyId })
      .setIssuedAt(now)
      .setExpirationTime(now + REFRESH_TOKEN_TTL_SECONDS)
      .sign(accessTokenKey.cryptoKey);
  }

  const response: TokenResponsePayload = {
    id_token: idToken,
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
  };
  if (refreshToken) {
    response.refresh_token = refreshToken;
  }

  return response;
};

const normalizeRefreshTokenScopes = (scope: string, allowedScopes: string[]) => {
  const scopes = normalizeScopes(scope.split(" ").filter(Boolean));
  if (scopes.length === 0 || !scopes.includes("openid")) {
    throw new DomainError("Invalid refresh_token", { status: 400, code: "invalid_grant" });
  }
  const allowed = new Set(normalizeScopes(allowedScopes));
  const notAllowed = scopes.filter((value) => !allowed.has(value));
  if (notAllowed.length > 0) {
    throw new DomainError("Invalid refresh_token", { status: 400, code: "invalid_grant" });
  }
  return scopes;
};

type RefreshTokenClaims = {
  subject: string;
  scope: string;
  userId: string;
  strategy: ClientAuthStrategy;
  emailVerified?: boolean;
};

const parseRefreshTokenPayload = (payload: Record<string, unknown>): RefreshTokenClaims => {
  const subject = typeof payload.sub === "string" ? payload.sub : null;
  const scope = typeof payload.scope === "string" ? payload.scope : null;
  const userId = typeof payload.uid === "string" ? payload.uid : null;
  const rawStrategy = payload.strategy;
  if (!subject || !scope || !userId || (rawStrategy !== "username" && rawStrategy !== "email")) {
    throw new DomainError("Invalid refresh_token", { status: 400, code: "invalid_grant" });
  }
  return {
    subject,
    scope,
    userId,
    strategy: rawStrategy,
    emailVerified: typeof payload.email_verified === "boolean" ? payload.email_verified : undefined,
  };
};

const verifyRefreshToken = async (params: {
  token: string;
  tenantId: string;
  apiResourceId: string;
  clientId: string;
  origin: string;
}) => {
  let header: ReturnType<typeof decodeProtectedHeader>;
  try {
    header = decodeProtectedHeader(params.token);
  } catch (error) {
    throw new DomainError("Invalid refresh_token", { status: 400, code: "invalid_grant" });
  }
  if (!header.kid || !header.alg || !isJwtSigningAlg(header.alg)) {
    throw new DomainError("Invalid refresh_token", { status: 400, code: "invalid_grant" });
  }

  const keyJwk = await getPublicJwkByKid(params.tenantId, header.kid).catch(() => {
    throw new DomainError("Invalid refresh_token", { status: 400, code: "invalid_grant" });
  });
  const key = await importJWK(keyJwk, header.alg);
  const issuer = issuerForResource(params.origin, params.apiResourceId);

  const payload = await jwtVerify(params.token, key, {
    issuer,
    audience: params.clientId,
    algorithms: [header.alg],
  })
    .then((result) => result.payload as Record<string, unknown>)
    .catch(() => {
      throw new DomainError("Invalid refresh_token", { status: 400, code: "invalid_grant" });
    });

  return parseRefreshTokenPayload(payload);
};

export const issueTokensFromCode = async (params: {
  code: CodeContext;
  codeVerifier?: string | null;
  redirectUri: string;
  clientSecret?: string | null;
  origin: string;
  authorizationCode?: string | null;
  auditContext?: TokenAuditContext | null;
}) => {
  const { code, codeVerifier, redirectUri, clientSecret, origin, authorizationCode, auditContext } = params;
  const traceId = code.traceId ?? null;
  const allowedMethods = parseTokenAuthMethods(code.client.tokenEndpointAuthMethods);
  const authMethod = auditContext?.authMethod ?? allowedMethods[0];
  const violationContext = {
    tenantId: code.tenantId,
    clientId: code.clientId,
    traceId,
    severity: "ERROR" as const,
    authMethod,
    clientSecretInBody: auditContext?.clientSecretInBody,
    requestContext: auditContext?.requestContext ?? null,
  };
  const reportViolation = createSecurityViolationReporter(violationContext);

  await emitAuditEvent({
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
      clientId: auditContext?.clientId ?? null,
      clientSecret: clientSecret ?? null,
      grantType: "authorization_code",
      redirectUri,
      authorizationCode: authorizationCode ?? undefined,
      includeAuthHeader: auditContext?.includeAuthHeader,
    }),
    requestContext: auditContext?.requestContext ?? null,
  });

  const normalized = resolveRedirectUri(redirectUri, code.client.redirectUris ?? []);
  if (normalized !== code.redirectUri) {
    await reportViolation(
      "redirect_uri_mismatch",
      { expectedRedirectUri: code.redirectUri, receivedRedirectUri: redirectUri },
      "redirect_uri mismatch",
    );
    throw new DomainError("redirect_uri mismatch", { status: 400, code: "invalid_grant" });
  }
  await withSecurityViolationAudit(() => assertClientAuth(code.client, authMethod, clientSecret), violationContext);
  if (code.client.pkceRequired) {
    await withSecurityViolationAudit(async () => assertPkce(code, codeVerifier), violationContext);
  }

  const strategy = fromPrismaLoginStrategy(code.loginStrategy);
  const strategies = parseClientAuthStrategies(code.client.authStrategies);
  const emailVerifiedClaim =
    strategy === "email"
      ? strategies.email.emailVerifiedMode === "user_choice"
        ? Boolean(code.emailVerifiedOverride)
        : strategies.email.emailVerifiedMode === "true"
      : undefined;
  const response = await issueTokens({
    tenantId: code.tenantId,
    apiResourceId: code.apiResourceId,
    client: code.client,
    user: code.user,
    subject: code.subject,
    scope: code.scope,
    origin,
    strategy,
    emailVerifiedClaim,
    nonce: code.nonce,
  });

  await emitAuditEvent({
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

export const issueTokensFromPassword = async (params: {
  apiResourceId: string;
  clientId: string;
  username: string;
  scope: string;
  origin: string;
  authMethod: TokenAuthMethod;
  clientSecret?: string | null;
  auditContext?: TokenAuditContext | null;
}) => {
  const { apiResourceId, clientId, username, scope, origin, authMethod, clientSecret, auditContext } = params;
  const { tenant, resource } = await getApiResourceWithTenant(apiResourceId);
  const client = await getClientForTenant(tenant.id, clientId);
  const violationContext = {
    tenantId: tenant.id,
    clientId: client.id,
    traceId: null,
    severity: "ERROR" as const,
    authMethod,
    clientSecretInBody: auditContext?.clientSecretInBody,
    requestContext: auditContext?.requestContext ?? null,
  };
  const reportViolation = createSecurityViolationReporter(violationContext);

  const clientResourceId = client.apiResourceId ?? tenant.defaultApiResourceId;
  if (clientResourceId !== resource.id) {
    await reportViolation("issuer_mismatch", {
      expectedApiResourceId: clientResourceId,
      receivedApiResourceId: resource.id,
    });
    throw new DomainError("Client is not configured for this issuer", { status: 400, code: "invalid_client" });
  }

  if (client.oauthClientMode !== "regular") {
    throw new DomainError("Client does not support password grant", { status: 400, code: "unsupported_grant_type" });
  }

  if (!client.allowedGrantTypes.includes("password")) {
    throw new DomainError("Client does not support password grant", { status: 400, code: "unsupported_grant_type" });
  }

  const strategies = parseClientAuthStrategies(client.authStrategies);
  if (!strategies.username.enabled) {
    throw new DomainError("Username authentication is disabled", { status: 400, code: "invalid_grant" });
  }

  const trimmedIdentifier = username.trim();
  if (!trimmedIdentifier) {
    throw new DomainError("username is required", { status: 400, code: "invalid_request" });
  }

  await withSecurityViolationAudit(() => assertClientAuth(client, authMethod, clientSecret), violationContext);

  const requestedScopes = normalizeRequestedScopes(scope, client.allowedScopes);
  const normalizedScope = requestedScopes.join(" ");
  const subject =
    strategies.username.subSource === "entered"
      ? trimmedIdentifier
      : await resolveStableSubject({
          tenantId: tenant.id,
          strategy: "username",
          identifier: trimmedIdentifier,
        });

  const user = await findOrCreateMockUser(tenant.id, trimmedIdentifier, {
    displayName: trimmedIdentifier,
    email: null,
  });

  return issueTokens({
    tenantId: tenant.id,
    apiResourceId: resource.id,
    client,
    user,
    subject,
    scope: normalizedScope,
    origin,
    strategy: "username",
  });
};

export const issueTokensFromRefresh = async (params: {
  apiResourceId: string;
  clientId: string;
  refreshToken: string;
  scope?: string;
  origin: string;
  authMethod: TokenAuthMethod;
  clientSecret?: string | null;
  auditContext?: TokenAuditContext | null;
}) => {
  const { apiResourceId, clientId, refreshToken, scope, origin, authMethod, clientSecret, auditContext } = params;
  const { tenant, resource } = await getApiResourceWithTenant(apiResourceId);
  const client = await getClientForTenant(tenant.id, clientId);
  const violationContext = {
    tenantId: tenant.id,
    clientId: client.id,
    traceId: null,
    severity: "ERROR" as const,
    authMethod,
    clientSecretInBody: auditContext?.clientSecretInBody,
    requestContext: auditContext?.requestContext ?? null,
  };
  const reportViolation = createSecurityViolationReporter(violationContext);

  const clientResourceId = client.apiResourceId ?? tenant.defaultApiResourceId;
  if (clientResourceId !== resource.id) {
    await reportViolation("issuer_mismatch", {
      expectedApiResourceId: clientResourceId,
      receivedApiResourceId: resource.id,
    });
    throw new DomainError("Client is not configured for this issuer", { status: 400, code: "invalid_client" });
  }

  if (client.oauthClientMode === "proxy") {
    throw new DomainError("Client does not support refresh_token grant", {
      status: 400,
      code: "unsupported_grant_type",
    });
  }

  if (!client.allowedGrantTypes.includes("refresh_token")) {
    throw new DomainError("Client does not support refresh_token grant", {
      status: 400,
      code: "unsupported_grant_type",
    });
  }

  await emitAuditEvent({
    tenantId: tenant.id,
    clientId: client.id,
    traceId: null,
    actorId: null,
    eventType: "TOKEN_REFRESH_RECEIVED",
    severity: "INFO",
    message: "Refresh token request received",
    details: buildTokenRefreshReceivedDetails({
      authMethod,
      clientSecretInBody: auditContext?.clientSecretInBody,
      scope,
      clientId,
      clientSecret: clientSecret ?? null,
      grantType: "refresh_token",
      refreshToken,
      includeAuthHeader: auditContext?.includeAuthHeader,
    }),
    requestContext: auditContext?.requestContext ?? null,
  });

  await withSecurityViolationAudit(() => assertClientAuth(client, authMethod, clientSecret), violationContext);

  const refreshPayload = await verifyRefreshToken({
    token: refreshToken,
    tenantId: tenant.id,
    apiResourceId: resource.id,
    clientId: client.clientId,
    origin,
  });

  const refreshScopes = normalizeRefreshTokenScopes(refreshPayload.scope, client.allowedScopes);
  let requestedScopes = refreshScopes;
  if (scope) {
    requestedScopes = normalizeRequestedScopes(scope, client.allowedScopes);
    const refreshSet = new Set(refreshScopes);
    const outside = requestedScopes.filter((value) => !refreshSet.has(value));
    if (outside.length > 0) {
      throw new DomainError("Refresh token scope exceeds original grant", {
        status: 400,
        code: "invalid_scope",
      });
    }
  }

  const user = await prisma.mockUser.findFirst({
    where: { id: refreshPayload.userId, tenantId: tenant.id },
  });
  if (!user) {
    throw new DomainError("Invalid refresh_token", { status: 400, code: "invalid_grant" });
  }

  const tokens = await issueTokens({
    tenantId: tenant.id,
    apiResourceId: resource.id,
    client,
    user,
    subject: refreshPayload.subject,
    scope: requestedScopes.join(" "),
    origin,
    strategy: refreshPayload.strategy,
    emailVerifiedClaim: refreshPayload.emailVerified,
  });

  await emitAuditEvent({
    tenantId: tenant.id,
    clientId: client.id,
    traceId: null,
    actorId: null,
    eventType: "TOKEN_REFRESH_COMPLETED",
    severity: "INFO",
    message: "Refresh token response issued",
    details: tokens,
    requestContext: auditContext?.requestContext ?? null,
  });

  return tokens;
};
