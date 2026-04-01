import { URLSearchParams } from "node:url";

import { addMinutes } from "date-fns";

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";
import { DomainError } from "@/server/errors";
import { computeS256Challenge } from "@/server/crypto/pkce";
import { generateOpaqueToken } from "@/server/crypto/opaque-token";
import { mapAppScopesToProvider } from "@/server/oidc/proxy/scope-mapping";
import { resolveUpstreamAuthMethod } from "@/server/oidc/token-auth-method";
import { buildPreauthorizedAdminCallbackUrl } from "@/server/oidc/preauthorized/constants";
import { emitAuditEvent, recordSecurityViolation } from "@/server/services/audit-service";
import {
  buildProxyCallbackErrorDetails,
  buildProxyCallbackSuccessDetails,
  buildProxyFlowDiagnostics,
  buildProxyRedirectOutDetails,
  buildProviderTokenExchangeDiagnostics,
  toTokenResponsePayload,
} from "@/server/services/audit-event";
import { getClientByIdForTenant } from "@/server/services/client-service";
import { createPreauthorizedIdentity } from "@/server/services/preauthorized-identity-service";
import { requestProviderTokens } from "@/server/services/proxy-service";
import { sanitizeProviderError, sanitizeProviderErrorDescription } from "@/server/services/proxy-utils";
import type { ProxyFlowRequestDetails } from "@/server/services/audit-event";
import type { RequestContext } from "@/server/utils/request-context";
import { searchParamsToRecord } from "@/server/utils/search-params";

const ADMIN_AUTH_TTL_MINUTES = 5;
export const ADMIN_AUTH_TTL_SECONDS = ADMIN_AUTH_TTL_MINUTES * 60;

type StartAdminAuthArgs = {
  tenantId: string;
  clientId: string;
  adminUserId: string;
  origin: string;
  identityLabel?: string | null;
  requestContext?: RequestContext;
};

type AdminCallbackArgs = {
  tenantId: string;
  clientId: string;
  adminUserId: string;
  state: string;
  code?: string | null;
  providerError?: string | null;
  providerErrorDescription?: string | null;
  transactionCookie?: string | null;
  callbackRequest: ProxyFlowRequestDetails;
  callbackParams: Record<string, string | string[]>;
  requestContext?: RequestContext;
};

const adminAuthInclude = {
  client: { include: { proxyConfig: true } },
  tenant: true,
} satisfies Prisma.AdminAuthTransactionInclude;

type AdminAuthTransactionWithRelations = Prisma.AdminAuthTransactionGetPayload<{ include: typeof adminAuthInclude }>;

const getAdminAuthTransaction = async (id: string): Promise<AdminAuthTransactionWithRelations | null> => {
  return prisma.adminAuthTransaction.findUnique({
    where: { id },
    include: adminAuthInclude,
  });
};

const markAdminAuthTransactionCompleted = async (id: string) => {
  await prisma.adminAuthTransaction.delete({ where: { id } });
};

export const startPreauthorizedAdminAuth = async (params: StartAdminAuthArgs) => {
  const client = await getClientByIdForTenant(params.tenantId, params.clientId);
  if (client.oauthClientMode !== "preauthorized") {
    throw new DomainError("Client is not preauthorized", { status: 400 });
  }
  const proxyConfig = client.proxyConfig;
  if (!proxyConfig) {
    throw new DomainError("Proxy configuration missing", { status: 500 });
  }

  const providerScope = mapAppScopesToProvider(client.allowedScopes.join(" "), proxyConfig);
  const callbackUrl = buildPreauthorizedAdminCallbackUrl(params.origin, client.id);
  let providerCodeVerifier: string | null = null;
  let providerCodeChallenge: string | null = null;
  if (proxyConfig.pkceSupported) {
    providerCodeVerifier = generateOpaqueToken(48);
    providerCodeChallenge = computeS256Challenge(providerCodeVerifier);
  }

  const transaction = await prisma.adminAuthTransaction.create({
    data: {
      tenantId: client.tenantId,
      clientId: client.id,
      adminUserId: params.adminUserId,
      redirectUri: callbackUrl,
      providerScope,
      providerCodeVerifier,
      providerPkceEnabled: Boolean(proxyConfig.pkceSupported),
      identityLabel: params.identityLabel?.trim() ? params.identityLabel.trim() : null,
      expiresAt: addMinutes(new Date(), ADMIN_AUTH_TTL_MINUTES),
    },
  });

  const authorizeUrl = new URL(proxyConfig.authorizationEndpoint);
  authorizeUrl.searchParams.set("client_id", proxyConfig.upstreamClientId);
  authorizeUrl.searchParams.set("redirect_uri", callbackUrl);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("scope", providerScope);
  authorizeUrl.searchParams.set("state", transaction.id);

  if (proxyConfig.pkceSupported && providerCodeChallenge) {
    authorizeUrl.searchParams.set("code_challenge", providerCodeChallenge);
    authorizeUrl.searchParams.set("code_challenge_method", "S256");
  }

  const providerAuthorizationUrl = authorizeUrl.toString();
  const providerAuthorizationParams = searchParamsToRecord(authorizeUrl.searchParams);

  await emitAuditEvent({
    tenantId: client.tenantId,
    clientId: client.id,
    traceId: transaction.id,
    actorId: params.adminUserId,
    eventType: "PREAUTHORIZED_ADMIN_REDIRECT_OUT",
    severity: "INFO",
    message: "Redirected to provider for preauthorized capture",
    details: buildProxyRedirectOutDetails({
      providerType: proxyConfig.providerType,
      providerScope,
      providerPkceEnabled: proxyConfig.pkceSupported,
      providerAuthorizationUrl,
      providerAuthorizationParams,
      redirectUri: callbackUrl,
      state: transaction.id,
      codeChallenge: providerCodeChallenge ?? undefined,
      codeChallengeMethod: providerCodeChallenge ? "S256" : undefined,
      codeVerifier: providerCodeVerifier ?? undefined,
    }),
    requestContext: params.requestContext ?? null,
  });

  return { transactionId: transaction.id, authorizationUrl: providerAuthorizationUrl };
};

export const completePreauthorizedAdminAuth = async (params: AdminCallbackArgs) => {
  if (!params.transactionCookie || params.transactionCookie !== params.state) {
    await recordSecurityViolation({
      tenantId: params.tenantId,
      clientId: params.clientId,
      traceId: params.state,
      reason: "state_mismatch",
      severity: "ERROR",
      expectedState: params.transactionCookie ?? null,
      receivedState: params.state,
      requestContext: params.requestContext ?? null,
      message: "Preauthorized admin state mismatch",
    });
    throw new DomainError("Invalid or missing admin transaction", { status: 400, code: "invalid_request" });
  }

  const transaction = await getAdminAuthTransaction(params.state);
  if (!transaction) {
    await recordSecurityViolation({
      tenantId: params.tenantId,
      clientId: params.clientId,
      traceId: params.state,
      reason: "state_not_found",
      severity: "ERROR",
      receivedState: params.state,
      requestContext: params.requestContext ?? null,
      message: "Preauthorized admin transaction not found",
    });
    throw new DomainError("Admin transaction not found", { status: 400, code: "invalid_request" });
  }

  if (transaction.clientId !== params.clientId) {
    throw new DomainError("Admin transaction client mismatch", { status: 400, code: "invalid_request" });
  }

  if (transaction.adminUserId !== params.adminUserId) {
    throw new DomainError("Admin transaction does not match user", { status: 403, code: "access_denied" });
  }

  const proxyConfig = transaction.client.proxyConfig;
  let exchangeDiagnostics: ReturnType<typeof buildProviderTokenExchangeDiagnostics> | null = null;

  const buildCallbackDiagnostics = (options: {
    request?: ProxyFlowRequestDetails;
    response?: { status?: number | null; headers?: Record<string, string>; body?: string | null } | null;
  } = {}) =>
    buildProxyFlowDiagnostics({
      stage: "callback",
      request: options.request ?? params.callbackRequest,
      response: options.response ?? null,
      params: params.callbackParams,
      meta: { clientId: transaction.client.clientId, traceId: transaction.id },
    });

  const baseCallbackDiagnostics = buildCallbackDiagnostics();

  const failCallback = async (options: {
    message: string;
    error: string;
    errorDescription?: string | null;
    status: number;
    code?: string;
    rawError?: string | null;
    rawErrorDescription?: string | null;
    diagnostics?: ReturnType<typeof buildProxyFlowDiagnostics> | null;
  }): Promise<never> => {
    await emitAuditEvent({
      tenantId: transaction.tenantId,
      clientId: transaction.clientId,
      traceId: transaction.id,
      actorId: params.adminUserId,
      eventType: "PREAUTHORIZED_ADMIN_CALLBACK_ERROR",
      severity: "ERROR",
      message: options.message,
      details: buildProxyCallbackErrorDetails({
        error: options.error,
        errorDescription: options.errorDescription ?? undefined,
        providerType: proxyConfig?.providerType,
        code: params.code ?? undefined,
        rawError: options.rawError ?? undefined,
        rawErrorDescription: options.rawErrorDescription ?? undefined,
        diagnostics: options.diagnostics ?? undefined,
        ...(exchangeDiagnostics ?? {}),
      }),
      requestContext: params.requestContext ?? null,
    });
    await markAdminAuthTransactionCompleted(transaction.id);
    throw new DomainError(options.errorDescription ?? options.message, {
      status: options.status,
      code: options.code,
    });
  };

  if (transaction.expiresAt < new Date()) {
    return failCallback({
      message: "Admin transaction expired",
      error: "transaction_expired",
      status: 400,
      code: "invalid_request",
      diagnostics: baseCallbackDiagnostics,
    });
  }

  if (!proxyConfig) {
    return failCallback({
      message: "Proxy configuration missing",
      error: "config_missing",
      status: 500,
      diagnostics: baseCallbackDiagnostics,
    });
  }

  exchangeDiagnostics = buildProviderTokenExchangeDiagnostics({
    tokenEndpoint: proxyConfig.tokenEndpoint,
    authMethod: resolveUpstreamAuthMethod(proxyConfig.upstreamTokenEndpointAuthMethod),
    clientId: proxyConfig.upstreamClientId,
    grantType: "authorization_code",
    redirectUri: transaction.redirectUri,
    codeVerifierPresent: transaction.providerPkceEnabled ? Boolean(transaction.providerCodeVerifier) : undefined,
  });

  if (params.providerError) {
    const error = sanitizeProviderError(params.providerError);
    const description = sanitizeProviderErrorDescription(params.providerErrorDescription ?? undefined);
    return failCallback({
      message: "Provider returned error",
      error,
      errorDescription: description,
      status: 400,
      code: error,
      rawError: params.providerError ?? undefined,
      rawErrorDescription: params.providerErrorDescription ?? undefined,
      diagnostics: baseCallbackDiagnostics,
    });
  }

  if (!params.code) {
    return failCallback({
      message: "Provider did not return a code",
      error: "missing_code",
      status: 400,
      code: "invalid_request",
      diagnostics: baseCallbackDiagnostics,
    });
  }

  const tokenRequest = new URLSearchParams();
  tokenRequest.set("grant_type", "authorization_code");
  tokenRequest.set("code", params.code);
  tokenRequest.set("redirect_uri", transaction.redirectUri);
  tokenRequest.set("client_id", proxyConfig.upstreamClientId);
  if (transaction.providerPkceEnabled && transaction.providerCodeVerifier) {
    tokenRequest.set("code_verifier", transaction.providerCodeVerifier);
  }

  let response;
  try {
    response = await requestProviderTokens(proxyConfig, tokenRequest);
  } catch (error) {
    const errorCode = error instanceof DomainError && error.options.code ? error.options.code : "server_error";
    const description = sanitizeProviderErrorDescription(
      error instanceof Error ? error.message : typeof error === "string" ? error : String(error),
    );
    return failCallback({
      message: "Provider token exchange failed",
      error: sanitizeProviderError(errorCode),
      errorDescription: description,
      status: error instanceof DomainError ? error.options.status ?? 502 : 502,
      code: error instanceof DomainError ? error.options.code : undefined,
      diagnostics: baseCallbackDiagnostics,
    });
  }

  const callbackDiagnostics = buildCallbackDiagnostics({
    request: response.request,
    response: {
      status: response.status,
      headers: response.headers,
      body: response.rawBody,
    },
  });

  if (response.jsonParseError) {
    return failCallback({
      message: "Provider token response was not JSON",
      error: "invalid_token_response",
      status: 502,
      diagnostics: callbackDiagnostics,
    });
  }

  if (!response.json) {
    return failCallback({
      message: "Provider token response missing",
      error: "missing_token_response",
      status: 502,
      diagnostics: callbackDiagnostics,
    });
  }

  if (!response.ok) {
    const rawError = typeof response.json.error === "string" ? response.json.error : undefined;
    const rawDescription =
      typeof response.json.error_description === "string" ? response.json.error_description : undefined;
    const providerError = sanitizeProviderError(rawError);
    const description = sanitizeProviderErrorDescription(rawDescription);
    return failCallback({
      message: "Provider token exchange failed",
      error: providerError,
      errorDescription: description,
      status: 400,
      code: providerError,
      rawError,
      rawErrorDescription: rawDescription,
      diagnostics: callbackDiagnostics,
    });
  }

  let identity;
  try {
    identity = await createPreauthorizedIdentity({
      tenantId: transaction.tenantId,
      clientId: transaction.clientId,
      label: transaction.identityLabel,
      providerScope: transaction.providerScope,
      providerResponse: response.json,
    });
  } catch (error) {
    const errorCode = error instanceof DomainError && error.options.code ? error.options.code : "server_error";
    const description = sanitizeProviderErrorDescription(
      error instanceof Error ? error.message : typeof error === "string" ? error : String(error),
    );
    return failCallback({
      message: "Preauthorized identity capture failed",
      error: sanitizeProviderError(errorCode),
      errorDescription: description,
      status: error instanceof DomainError ? error.options.status ?? 500 : 500,
      code: error instanceof DomainError ? error.options.code : undefined,
      diagnostics: callbackDiagnostics,
    });
  }

  await emitAuditEvent({
    tenantId: transaction.tenantId,
    clientId: transaction.clientId,
    traceId: transaction.id,
    actorId: params.adminUserId,
    eventType: "PREAUTHORIZED_ADMIN_CALLBACK_SUCCESS",
    severity: "INFO",
    message: "Preauthorized identity captured",
    details: buildProxyCallbackSuccessDetails({
      providerType: proxyConfig.providerType,
      providerResponse: toTokenResponsePayload(response.json),
      diagnostics: callbackDiagnostics,
    }),
    requestContext: params.requestContext ?? null,
  });

  await markAdminAuthTransactionCompleted(transaction.id);

  return identity;
};
