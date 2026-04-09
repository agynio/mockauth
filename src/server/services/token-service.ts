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
import type { ClientAuthStrategy } from "@/server/oidc/auth-strategy";
import { fromPrismaLoginStrategy, parseClientAuthStrategies } from "@/server/oidc/auth-strategy";
import { normalizeScopes } from "@/server/oidc/scopes";
import { parseTokenAuthMethods, type TokenAuthMethod } from "@/server/oidc/token-auth-method";
import { DEFAULT_JWT_SIGNING_ALG } from "@/server/oidc/signing-alg";
import { emitAuditEvent } from "@/server/services/audit-service";
import {
  buildTokenAuthCodeReceivedDetails,
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

  return {
    id_token: idToken,
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
  };
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
  const trimmedIdentifier = username.trim();
  if (!trimmedIdentifier) {
    throw new DomainError("username is required", { status: 400, code: "invalid_request" });
  }

  const emailEnabled = strategies.email.enabled;
  const usernameEnabled = strategies.username.enabled;
  if (!emailEnabled && !usernameEnabled) {
    throw new DomainError("No authentication strategy is enabled", { status: 400, code: "invalid_grant" });
  }

  const looksLikeEmail = trimmedIdentifier.includes("@");
  const strategy: ClientAuthStrategy = emailEnabled && looksLikeEmail ? "email" : "username";
  if (strategy === "username" && !usernameEnabled) {
    throw new DomainError("Username authentication is disabled", { status: 400, code: "invalid_grant" });
  }

  await withSecurityViolationAudit(() => assertClientAuth(client, authMethod, clientSecret), violationContext);

  const requestedScopes = normalizeRequestedScopes(scope, client.allowedScopes);
  const normalizedScope = requestedScopes.join(" ");
  const selectedConfig = strategy === "email" ? strategies.email : strategies.username;
  const subject =
    selectedConfig.subSource === "entered"
      ? trimmedIdentifier
      : await resolveStableSubject({
          tenantId: tenant.id,
          strategy,
          identifier: trimmedIdentifier,
        });

  const emailVerifiedClaim =
    strategy === "email" && strategies.email.emailVerifiedMode === "true" ? true : undefined;
  const user = await findOrCreateMockUser(tenant.id, trimmedIdentifier, {
    displayName: trimmedIdentifier,
    email: strategy === "email" ? trimmedIdentifier : null,
  });

  return issueTokens({
    tenantId: tenant.id,
    apiResourceId: resource.id,
    client,
    user,
    subject,
    scope: normalizedScope,
    origin,
    strategy,
    emailVerifiedClaim,
  });
};
