import { URLSearchParams } from "node:url";

import { DomainError } from "@/server/errors";
import { resolveRedirectUri } from "@/server/oidc/redirect-uri";
import {
  isProxyAuthorizationCode,
  consumeProxyAuthorizationCode,
  requestProviderTokens,
} from "@/server/services/proxy-service";
import { buildProxyTokenResponse, sanitizeProviderError, sanitizeProviderErrorDescription } from "@/server/services/proxy-utils";
import { assertClientSecret, verifyPkce } from "@/server/services/token-service";
import { getApiResourceWithTenant } from "@/server/services/api-resource-service";
import { getClientForTenant } from "@/server/services/client-service";
import { emitAuditEvent, recordSecurityViolation } from "@/server/services/audit-service";
import type { RequestContext } from "@/server/utils/request-context";

type AuthorizationCodeGrantParams = {
  apiResourceId: string;
  code: string;
  redirectUri: string;
  codeVerifier: string;
  authMethod: "client_secret_basic" | "client_secret_post" | "none";
  clientIdFromRequest?: string | null;
  clientSecret?: string | null;
  auditContext?: ProxyTokenAuditContext | null;
};

type ProxyTokenAuditContext = {
  requestContext?: RequestContext | null;
  clientSecretInBody?: boolean;
  clientIdProvided?: boolean;
};

export const isProxyCode = isProxyAuthorizationCode;

export const completeProxyAuthorizationCodeGrant = async (
  params: AuthorizationCodeGrantParams,
): Promise<Record<string, unknown>> => {
  const { record, providerResponse } = await consumeProxyAuthorizationCode(params.code);
  const traceId = record.tokenExchange.transactionId ?? record.tokenExchange.transaction?.id ?? null;

  void emitAuditEvent({
    tenantId: record.tenantId,
    clientId: record.clientId,
    traceId,
    actorId: null,
    eventType: "TOKEN_AUTHCODE_RECEIVED",
    severity: "INFO",
    message: "Token request received",
    details: {
      authMethod: params.authMethod,
      clientSecretInBody: params.auditContext?.clientSecretInBody,
      clientIdProvided: params.auditContext?.clientIdProvided,
    },
    requestContext: params.auditContext?.requestContext ?? null,
  });

  if (record.apiResourceId !== params.apiResourceId) {
    void recordSecurityViolation({
      tenantId: record.tenantId,
      clientId: record.clientId,
      traceId,
      reason: "issuer_mismatch",
      authMethod: params.authMethod,
      clientSecretInBody: params.auditContext?.clientSecretInBody,
      requestContext: params.auditContext?.requestContext ?? null,
    });
    throw new DomainError("Authorization code does not match issuer", { status: 400, code: "invalid_grant" });
  }

  if (params.clientIdFromRequest && record.client.clientId !== params.clientIdFromRequest) {
    void recordSecurityViolation({
      tenantId: record.tenantId,
      clientId: record.clientId,
      traceId,
      reason: "client_mismatch",
      authMethod: params.authMethod,
      clientSecretInBody: params.auditContext?.clientSecretInBody,
      requestContext: params.auditContext?.requestContext ?? null,
    });
    throw new DomainError("Client mismatch", { status: 401, code: "invalid_client" });
  }

  if (record.client.tokenEndpointAuthMethod !== params.authMethod) {
    void recordSecurityViolation({
      tenantId: record.tenantId,
      clientId: record.clientId,
      traceId,
      reason: "auth_method_mismatch",
      authMethod: params.authMethod,
      clientSecretInBody: params.auditContext?.clientSecretInBody,
      requestContext: params.auditContext?.requestContext ?? null,
    });
    throw new DomainError("Client authentication method mismatch", { status: 401, code: "invalid_client" });
  }

  try {
    await assertClientSecret(record.client, params.clientSecret);
  } catch (error) {
    if (error instanceof DomainError) {
      const reason = error.message.includes("Client authentication required")
        ? "client_auth_missing"
        : error.message.includes("Invalid client credentials")
          ? "client_auth_invalid"
          : "auth_method_mismatch";
      void recordSecurityViolation({
        tenantId: record.tenantId,
        clientId: record.clientId,
        traceId,
        reason,
        authMethod: params.authMethod,
        clientSecretInBody: params.auditContext?.clientSecretInBody,
        requestContext: params.auditContext?.requestContext ?? null,
      });
    }
    throw error;
  }

  const normalizedRedirect = resolveRedirectUri(params.redirectUri, record.client.redirectUris ?? []);
  if (normalizedRedirect !== record.redirectUri) {
    void recordSecurityViolation({
      tenantId: record.tenantId,
      clientId: record.clientId,
      traceId,
      reason: "redirect_uri_mismatch",
      authMethod: params.authMethod,
      clientSecretInBody: params.auditContext?.clientSecretInBody,
      requestContext: params.auditContext?.requestContext ?? null,
    });
    throw new DomainError("redirect_uri mismatch", { status: 400, code: "invalid_grant" });
  }

  try {
    verifyPkce(record, params.codeVerifier);
  } catch (error) {
    if (error instanceof DomainError) {
      const reason = error.message.includes("Invalid code verifier") ? "pkce_mismatch" : "pkce_method_unsupported";
      void recordSecurityViolation({
        tenantId: record.tenantId,
        clientId: record.clientId,
        traceId,
        reason,
        authMethod: params.authMethod,
        clientSecretInBody: params.auditContext?.clientSecretInBody,
        requestContext: params.auditContext?.requestContext ?? null,
      });
    }
    throw error;
  }

  const proxyConfig = record.client.proxyConfig;
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

  void emitAuditEvent({
    tenantId: record.tenantId,
    clientId: record.clientId,
    traceId,
    actorId: null,
    eventType: "TOKEN_AUTHCODE_COMPLETED",
    severity: "INFO",
    message: "Token response issued",
    details: response,
    requestContext: params.auditContext?.requestContext ?? null,
  });

  return response;
};

type RefreshTokenGrantParams = {
  apiResourceId: string;
  clientId: string;
  refreshToken: string;
  scope?: string;
  authMethod: "client_secret_basic" | "client_secret_post" | "none";
  clientSecret?: string | null;
  auditContext?: ProxyTokenAuditContext | null;
};

export const completeProxyRefreshGrant = async (
  params: RefreshTokenGrantParams,
): Promise<Record<string, unknown>> => {
  const { tenant, resource } = await getApiResourceWithTenant(params.apiResourceId);
  const client = await getClientForTenant(tenant.id, params.clientId);

  const clientResourceId = client.apiResourceId ?? tenant.defaultApiResourceId;
  if (clientResourceId !== resource.id) {
    void recordSecurityViolation({
      tenantId: tenant.id,
      clientId: client.id,
      reason: "issuer_mismatch",
      authMethod: params.authMethod,
      clientSecretInBody: params.auditContext?.clientSecretInBody,
      requestContext: params.auditContext?.requestContext ?? null,
    });
    throw new DomainError("Client is not configured for this issuer", { status: 400, code: "invalid_client" });
  }

  if (client.oauthClientMode !== "proxy") {
    throw new DomainError("Client does not support proxy refresh", { status: 400, code: "unsupported_grant_type" });
  }

  const proxyConfig = client.proxyConfig;
  if (!proxyConfig) {
    throw new DomainError("Proxy configuration missing", { status: 500 });
  }

  if (client.tokenEndpointAuthMethod !== params.authMethod) {
    void recordSecurityViolation({
      tenantId: tenant.id,
      clientId: client.id,
      reason: "auth_method_mismatch",
      authMethod: params.authMethod,
      clientSecretInBody: params.auditContext?.clientSecretInBody,
      requestContext: params.auditContext?.requestContext ?? null,
    });
    throw new DomainError("Client authentication method mismatch", { status: 401, code: "invalid_client" });
  }

  void emitAuditEvent({
    tenantId: tenant.id,
    clientId: client.id,
    traceId: null,
    actorId: null,
    eventType: "TOKEN_REFRESH_RECEIVED",
    severity: "INFO",
    message: "Refresh token request received",
    details: {
      authMethod: params.authMethod,
      clientSecretInBody: params.auditContext?.clientSecretInBody,
      scope: params.scope,
    },
    requestContext: params.auditContext?.requestContext ?? null,
  });

  try {
    await assertClientSecret(client, params.clientSecret);
  } catch (error) {
    if (error instanceof DomainError) {
      const reason = error.message.includes("Client authentication required")
        ? "client_auth_missing"
        : error.message.includes("Invalid client credentials")
          ? "client_auth_invalid"
          : "auth_method_mismatch";
      void recordSecurityViolation({
        tenantId: tenant.id,
        clientId: client.id,
        reason,
        authMethod: params.authMethod,
        clientSecretInBody: params.auditContext?.clientSecretInBody,
        requestContext: params.auditContext?.requestContext ?? null,
      });
    }
    throw error;
  }

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
    if (error instanceof DomainError) {
      throw error;
    }
    throw new DomainError("Failed to contact provider", { status: 502 });
  }

  if (!response.ok) {
    const providerError = sanitizeProviderError(typeof response.json?.error === "string" ? response.json.error : undefined);
    const description = sanitizeProviderErrorDescription(
      typeof response.json?.error_description === "string" ? response.json.error_description : undefined,
    );
    throw new DomainError(description ?? "Provider rejected refresh_token", { status: 400, code: providerError });
  }

  const refreshResponse = buildProxyTokenResponse(response.json, {
    passthrough: proxyConfig.passthroughTokenResponse,
    fallbackScope: params.scope,
  });

  void emitAuditEvent({
    tenantId: tenant.id,
    clientId: client.id,
    traceId: null,
    actorId: null,
    eventType: "TOKEN_REFRESH_COMPLETED",
    severity: "INFO",
    message: "Refresh token response issued",
    details: refreshResponse,
    requestContext: params.auditContext?.requestContext ?? null,
  });

  return refreshResponse;
};
