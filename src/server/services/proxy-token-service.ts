import { URLSearchParams } from "node:url";

import { DomainError } from "@/server/errors";
import { resolveRedirectUri } from "@/server/oidc/redirect-uri";
import { buildProxyCallbackUrl } from "@/server/oidc/proxy/constants";
import { resolveUpstreamAuthMethod } from "@/server/oidc/token-auth-method";
import {
  consumeProxyAuthorizationCode,
  findProxyAuthorizationCodeRecord,
  isProxyAuthorizationCode,
  requestProviderTokens,
  type ProxyAuthorizationCodeWithRelations,
} from "@/server/services/proxy-service";
import { buildProxyTokenResponse, sanitizeProviderError, sanitizeProviderErrorDescription } from "@/server/services/proxy-utils";
import { assertClientAuth, verifyPkce } from "@/server/services/token-service";
import { getApiResourceWithTenant } from "@/server/services/api-resource-service";
import { getClientForTenant } from "@/server/services/client-service";
import { emitAuditEvent } from "@/server/services/audit-service";
import {
  buildProxyCallbackErrorDetails,
  buildProxyFlowDiagnostics,
  buildProviderTokenExchangeDiagnostics,
  buildTokenAuthCodeErrorDetails,
  buildTokenAuthCodeReceivedDetails,
  buildTokenRefreshReceivedDetails,
  toTokenResponsePayload,
  type TokenAuthCodeCompletedDetails,
  type ProxyFlowDiagnostics,
  type ProxyFlowRequestDetails,
  type TokenAuthMethod,
} from "@/server/services/audit-event";
import {
  createSecurityViolationReporter,
  SecurityViolationError,
  withSecurityViolationAudit,
} from "@/server/services/security-violation";
import type { RequestContext } from "@/server/utils/request-context";

type AuthorizationCodeGrantParams = {
  apiResourceId: string;
  code: string;
  redirectUri: string;
  codeVerifier?: string | null;
  authMethod: TokenAuthMethod;
  clientIdFromRequest?: string | null;
  clientSecret?: string | null;
  auditContext?: ProxyTokenAuditContext | null;
};

type ProxyTokenAuditContext = {
  requestContext?: RequestContext | null;
  origin?: string | null;
  clientSecretInBody?: boolean;
  clientIdProvided?: boolean;
  includeAuthHeader?: boolean;
  requestParams?: Record<string, string | string[]>;
  request?: ProxyFlowRequestDetails | null;
};

type ProxyAuthCodeAuditContext = {
  traceId: string | null;
  requestDiagnostics?: ProxyFlowDiagnostics;
  exchangeDiagnostics: ReturnType<typeof buildProviderTokenExchangeDiagnostics> | null;
};

const resolveErrorCode = (error: unknown, fallback: string | null = "server_error") => {
  if (error instanceof DomainError && error.options.code) {
    return error.options.code;
  }
  return fallback;
};

const resolveErrorDescription = (error: unknown) => {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return String(error);
};

const buildProxyAuthCodeAuditContext = (
  record: ProxyAuthorizationCodeWithRelations,
  params: AuthorizationCodeGrantParams,
): ProxyAuthCodeAuditContext => {
  const traceId = record.tokenExchange.transactionId ?? record.tokenExchange.transaction?.id ?? null;
  const requestDiagnostics = params.auditContext?.request
    ? buildProxyFlowDiagnostics({
        stage: "token",
        request: params.auditContext.request,
        response: null,
        params: params.auditContext.requestParams ?? {},
        meta: {
          clientId: record.client.clientId,
          traceId,
        },
      })
    : undefined;

  const proxyConfig = record.client.proxyConfig;
  const callbackUrl = params.auditContext?.origin
    ? buildProxyCallbackUrl(params.auditContext.origin, record.apiResourceId)
    : undefined;
  const exchangeDiagnostics = proxyConfig
    ? buildProviderTokenExchangeDiagnostics({
        tokenEndpoint: proxyConfig.tokenEndpoint,
        authMethod: resolveUpstreamAuthMethod(proxyConfig.upstreamTokenEndpointAuthMethod),
        clientId: proxyConfig.upstreamClientId,
        grantType: "authorization_code",
        redirectUri: callbackUrl,
        codeVerifierPresent: record.tokenExchange.transaction?.providerPkceEnabled
          ? Boolean(record.tokenExchange.transaction?.providerCodeVerifier)
          : undefined,
      })
    : null;

  return { traceId, requestDiagnostics, exchangeDiagnostics };
};

const emitProxyAuthCodeReceivedAudit = async (
  record: ProxyAuthorizationCodeWithRelations,
  params: AuthorizationCodeGrantParams,
  auditContext: ProxyAuthCodeAuditContext,
) => {
  await emitAuditEvent({
    tenantId: record.tenantId,
    clientId: record.clientId,
    traceId: auditContext.traceId,
    actorId: null,
    eventType: "TOKEN_AUTHCODE_RECEIVED",
    severity: "INFO",
    message: "Token request received",
    details: buildTokenAuthCodeReceivedDetails({
      authMethod: params.authMethod,
      clientSecretInBody: params.auditContext?.clientSecretInBody,
      clientIdProvided: params.auditContext?.clientIdProvided,
      clientId: params.clientIdFromRequest ?? null,
      clientSecret: params.clientSecret ?? null,
      grantType: "authorization_code",
      redirectUri: params.redirectUri,
      authorizationCode: params.code,
      includeAuthHeader: params.auditContext?.includeAuthHeader,
      diagnostics: auditContext.requestDiagnostics,
      upstreamCall: false,
    }),
    requestContext: params.auditContext?.requestContext ?? null,
  });
};

const emitProxyAuthCodeErrorAudit = async (
  record: ProxyAuthorizationCodeWithRelations,
  params: AuthorizationCodeGrantParams,
  auditContext: ProxyAuthCodeAuditContext,
  error: unknown,
) => {
  if (!auditContext.exchangeDiagnostics) {
    return;
  }
  const errorCode = resolveErrorCode(error);
  if (!errorCode) {
    return;
  }
  const description = resolveErrorDescription(error);
  await emitAuditEvent({
    tenantId: record.tenantId,
    clientId: record.clientId,
    traceId: auditContext.traceId,
    actorId: null,
    eventType: "TOKEN_AUTHCODE_COMPLETED",
    severity: "ERROR",
    message: "Token exchange failed",
    details: buildTokenAuthCodeErrorDetails({
      error: errorCode,
      errorDescription: description,
      exchangeDiagnostics: auditContext.exchangeDiagnostics,
      diagnostics: auditContext.requestDiagnostics,
      upstreamCall: false,
    }),
    requestContext: params.auditContext?.requestContext ?? null,
  });
};

const emitInvalidGrantAudit = async (params: AuthorizationCodeGrantParams, error: unknown) => {
  const errorCode = resolveErrorCode(error, null);
  if (errorCode !== "invalid_grant") {
    return;
  }
  const auditRecord = await findProxyAuthorizationCodeRecord(params.code);
  if (!auditRecord?.client.proxyConfig) {
    return;
  }
  const auditContext = buildProxyAuthCodeAuditContext(auditRecord, params);
  await emitProxyAuthCodeReceivedAudit(auditRecord, params, auditContext);
  await emitProxyAuthCodeErrorAudit(auditRecord, params, auditContext, error);
};

export const isProxyCode = isProxyAuthorizationCode;

export const completeProxyAuthorizationCodeGrant = async (
  params: AuthorizationCodeGrantParams,
): Promise<Record<string, unknown>> => {
  const { record, providerResponse } = await consumeProxyAuthorizationCode(params.code).catch(async (error) => {
    await emitInvalidGrantAudit(params, error).catch(() => undefined);
    throw error;
  });
  const authCodeAuditContext = buildProxyAuthCodeAuditContext(record, params);
  await emitProxyAuthCodeReceivedAudit(record, params, authCodeAuditContext);

  const traceId = authCodeAuditContext.traceId;
  const violationContext = {
    tenantId: record.tenantId,
    clientId: record.clientId,
    traceId,
    severity: "ERROR" as const,
    authMethod: params.authMethod,
    clientSecretInBody: params.auditContext?.clientSecretInBody,
    requestContext: params.auditContext?.requestContext ?? null,
  };
  const reportViolation = createSecurityViolationReporter(violationContext);
  const proxyConfig = record.client.proxyConfig;

  try {
    if (record.apiResourceId !== params.apiResourceId) {
      await reportViolation("issuer_mismatch", {
        expectedApiResourceId: record.apiResourceId,
        receivedApiResourceId: params.apiResourceId,
      });
      throw new DomainError("Authorization code does not match issuer", { status: 400, code: "invalid_grant" });
    }

    if (params.clientIdFromRequest && record.client.clientId !== params.clientIdFromRequest) {
      await reportViolation("client_mismatch", {
        expectedClientId: record.client.clientId,
        receivedClientId: params.clientIdFromRequest,
      });
      throw new DomainError("Client mismatch", { status: 401, code: "invalid_client" });
    }

    await withSecurityViolationAudit(
      () => assertClientAuth(record.client, params.authMethod, params.clientSecret),
      violationContext,
    );

    const normalizedRedirect = resolveRedirectUri(params.redirectUri, record.client.redirectUris ?? []);
    if (normalizedRedirect !== record.redirectUri) {
      await reportViolation("redirect_uri_mismatch", {
        expectedRedirectUri: record.redirectUri,
        receivedRedirectUri: params.redirectUri,
      });
      throw new DomainError("redirect_uri mismatch", { status: 400, code: "invalid_grant" });
    }

    if (record.client.pkceRequired) {
      await withSecurityViolationAudit(async () => {
        if (!params.codeVerifier) {
          throw new SecurityViolationError(
            "Code verifier required",
            { status: 400, code: "invalid_grant" },
            "pkce_mismatch",
            {
              expectedCodeChallenge: record.codeChallenge,
              receivedCodeVerifier: params.codeVerifier ?? undefined,
            },
          );
        }
        verifyPkce(record, params.codeVerifier);
      }, violationContext);
    }

    if (!proxyConfig) {
      throw new DomainError("Proxy configuration missing", { status: 500 });
    }

    const providerScope = record.tokenExchange.transaction?.providerScope;
    if (typeof providerScope !== "string" || providerScope.trim().length === 0) {
      throw new DomainError("Proxy transaction is missing provider scope", { status: 500 });
    }

    const response = buildProxyTokenResponse(providerResponse, {
      passthrough: proxyConfig.passthroughTokenResponse,
      fallbackScope: providerScope,
    });

    const issuedTokenDetails = {
      upstreamCall: false,
      providerResponse,
      ...toTokenResponsePayload(response),
    } satisfies TokenAuthCodeCompletedDetails;

    await emitAuditEvent({
      tenantId: record.tenantId,
      clientId: record.clientId,
      traceId,
      actorId: null,
      eventType: "TOKEN_AUTHCODE_COMPLETED",
      severity: "INFO",
      message: "Token response issued",
      details: issuedTokenDetails,
      requestContext: params.auditContext?.requestContext ?? null,
    });

    return response;
  } catch (error) {
    await emitProxyAuthCodeErrorAudit(record, params, authCodeAuditContext, error);
    throw error;
  }
};

type RefreshTokenGrantParams = {
  apiResourceId: string;
  clientId: string;
  refreshToken: string;
  scope?: string;
  authMethod: TokenAuthMethod;
  clientSecret?: string | null;
  auditContext?: ProxyTokenAuditContext | null;
};

export const completeProxyRefreshGrant = async (
  params: RefreshTokenGrantParams,
): Promise<Record<string, unknown>> => {
  const { tenant, resource } = await getApiResourceWithTenant(params.apiResourceId);
  const client = await getClientForTenant(tenant.id, params.clientId);
  const violationContext = {
    tenantId: tenant.id,
    clientId: client.id,
    traceId: null,
    severity: "ERROR" as const,
    authMethod: params.authMethod,
    clientSecretInBody: params.auditContext?.clientSecretInBody,
    requestContext: params.auditContext?.requestContext ?? null,
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

  if (client.oauthClientMode !== "proxy") {
    throw new DomainError("Client does not support proxy refresh", { status: 400, code: "unsupported_grant_type" });
  }

  const requestDiagnostics = params.auditContext?.request
    ? buildProxyFlowDiagnostics({
        stage: "token",
        request: params.auditContext.request,
        response: null,
        params: params.auditContext.requestParams ?? {},
        meta: {
          clientId: client.clientId,
          traceId: null,
        },
      })
    : undefined;

  const proxyConfig = client.proxyConfig;
  if (!proxyConfig) {
    throw new DomainError("Proxy configuration missing", { status: 500 });
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
      authMethod: params.authMethod,
      clientSecretInBody: params.auditContext?.clientSecretInBody,
      scope: params.scope,
      clientId: params.clientId ?? null,
      clientSecret: params.clientSecret ?? null,
      grantType: "refresh_token",
      refreshToken: params.refreshToken,
      includeAuthHeader: params.auditContext?.includeAuthHeader,
      diagnostics: requestDiagnostics,
    }),
    requestContext: params.auditContext?.requestContext ?? null,
  });

  await withSecurityViolationAudit(
    () => assertClientAuth(client, params.authMethod, params.clientSecret),
    violationContext,
  );

  const refreshDiagnostics = buildProviderTokenExchangeDiagnostics({
    tokenEndpoint: proxyConfig.tokenEndpoint,
    authMethod: resolveUpstreamAuthMethod(proxyConfig.upstreamTokenEndpointAuthMethod),
    clientId: proxyConfig.upstreamClientId,
    grantType: "refresh_token",
  });

  type RefreshErrorDetails = Parameters<typeof buildProxyCallbackErrorDetails>[0];
  const recordRefreshError = async (details: RefreshErrorDetails, diagnostics?: ProxyFlowDiagnostics) => {
    await emitAuditEvent({
      tenantId: tenant.id,
      clientId: client.id,
      traceId: null,
      actorId: null,
      eventType: "PROXY_CALLBACK_ERROR",
      severity: "ERROR",
      message: "Proxy provider refresh failed",
      details: buildProxyCallbackErrorDetails({
        ...details,
        diagnostics: diagnostics ?? undefined,
      }),
      requestContext: params.auditContext?.requestContext ?? null,
    });
  };

  const body = new URLSearchParams();
  body.set("grant_type", "refresh_token");
  body.set("refresh_token", params.refreshToken);
  body.set("client_id", proxyConfig.upstreamClientId);
  if (params.scope) {
    body.set("scope", params.scope);
  }

  let response;
  try {
    response = await requestProviderTokens(proxyConfig, body);
  } catch (error) {
    const errorCode = error instanceof DomainError && error.options.code ? error.options.code : "server_error";
    const description = sanitizeProviderErrorDescription(
      error instanceof Error ? error.message : typeof error === "string" ? error : String(error),
    );
    await recordRefreshError({
      error: sanitizeProviderError(errorCode),
      errorDescription: description,
      providerType: proxyConfig.providerType,
      ...refreshDiagnostics,
    }, requestDiagnostics);
    if (error instanceof DomainError) {
      throw error;
    }
    throw new DomainError("Failed to contact provider", { status: 502 });
  }
  const exchangeDiagnostics = buildProxyFlowDiagnostics({
    stage: "token",
    request: response.request,
    response: {
      status: response.status,
      headers: response.headers,
      body: response.rawBody,
    },
    params: params.auditContext?.requestParams ?? {},
    meta: {
      clientId: client.clientId,
      traceId: null,
    },
  });

  if (response.jsonParseError) {
    await recordRefreshError({
      error: "invalid_token_response",
      errorDescription: "Provider token response was not JSON",
      providerType: proxyConfig.providerType,
      ...refreshDiagnostics,
    }, exchangeDiagnostics);
    throw new DomainError("Provider token response was not JSON", { status: 502 });
  }

  if (!response.json) {
    await recordRefreshError({
      error: "missing_token_response",
      providerType: proxyConfig.providerType,
      ...refreshDiagnostics,
    }, exchangeDiagnostics);
    throw new DomainError("Provider token response missing", { status: 502 });
  }

  if (!response.ok) {
    const providerError = sanitizeProviderError(typeof response.json?.error === "string" ? response.json.error : undefined);
    const description = sanitizeProviderErrorDescription(
      typeof response.json?.error_description === "string" ? response.json.error_description : undefined,
    );
    await recordRefreshError({
      error: providerError,
      errorDescription: description,
      providerType: proxyConfig.providerType,
      rawError: typeof response.json?.error === "string" ? response.json.error : undefined,
      rawErrorDescription:
        typeof response.json?.error_description === "string" ? response.json.error_description : undefined,
      ...refreshDiagnostics,
    }, exchangeDiagnostics);
    throw new DomainError(description ?? "Provider rejected refresh_token", { status: 400, code: providerError });
  }

  const refreshResponse = buildProxyTokenResponse(response.json, {
    passthrough: proxyConfig.passthroughTokenResponse,
    fallbackScope: params.scope,
  });

  await emitAuditEvent({
    tenantId: tenant.id,
    clientId: client.id,
    traceId: null,
    actorId: null,
    eventType: "TOKEN_REFRESH_COMPLETED",
    severity: "INFO",
    message: "Refresh token response issued",
    details: toTokenResponsePayload(refreshResponse, exchangeDiagnostics),
    requestContext: params.auditContext?.requestContext ?? null,
  });

  return refreshResponse;
};
