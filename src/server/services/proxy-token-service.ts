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

type AuthorizationCodeGrantParams = {
  apiResourceId: string;
  code: string;
  redirectUri: string;
  codeVerifier: string;
  authMethod: "client_secret_basic" | "client_secret_post" | "none";
  clientIdFromRequest?: string | null;
  clientSecret?: string | null;
};

export const isProxyCode = isProxyAuthorizationCode;

export const completeProxyAuthorizationCodeGrant = async (
  params: AuthorizationCodeGrantParams,
): Promise<Record<string, unknown>> => {
  const { record, providerResponse } = await consumeProxyAuthorizationCode(params.code);

  if (record.apiResourceId !== params.apiResourceId) {
    throw new DomainError("Authorization code does not match issuer", { status: 400, code: "invalid_grant" });
  }

  if (params.clientIdFromRequest && record.client.clientId !== params.clientIdFromRequest) {
    throw new DomainError("Client mismatch", { status: 401, code: "invalid_client" });
  }

  if (record.client.tokenEndpointAuthMethod !== params.authMethod) {
    throw new DomainError("Client authentication method mismatch", { status: 401, code: "invalid_client" });
  }

  await assertClientSecret(record.client, params.clientSecret);

  const normalizedRedirect = resolveRedirectUri(params.redirectUri, record.client.redirectUris ?? []);
  if (normalizedRedirect !== record.redirectUri) {
    throw new DomainError("redirect_uri mismatch", { status: 400, code: "invalid_grant" });
  }

  verifyPkce(record, params.codeVerifier);

  const proxyConfig = record.client.proxyConfig;
  if (!proxyConfig) {
    throw new DomainError("Proxy configuration missing", { status: 500 });
  }

  const providerScope = record.tokenExchange.transaction?.providerScope;
  if (typeof providerScope !== "string" || providerScope.trim().length === 0) {
    throw new DomainError("Proxy transaction is missing provider scope", { status: 500 });
  }

  return buildProxyTokenResponse(providerResponse, {
    passthrough: proxyConfig.passthroughTokenResponse,
    fallbackScope: providerScope,
  });
};

type RefreshTokenGrantParams = {
  apiResourceId: string;
  clientId: string;
  refreshToken: string;
  scope?: string;
  authMethod: "client_secret_basic" | "client_secret_post" | "none";
  clientSecret?: string | null;
};

export const completeProxyRefreshGrant = async (
  params: RefreshTokenGrantParams,
): Promise<Record<string, unknown>> => {
  const { tenant, resource } = await getApiResourceWithTenant(params.apiResourceId);
  const client = await getClientForTenant(tenant.id, params.clientId);

  const clientResourceId = client.apiResourceId ?? tenant.defaultApiResourceId;
  if (clientResourceId !== resource.id) {
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
    throw new DomainError("Client authentication method mismatch", { status: 401, code: "invalid_client" });
  }

  await assertClientSecret(client, params.clientSecret);

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

  return buildProxyTokenResponse(response.json, {
    passthrough: proxyConfig.passthroughTokenResponse,
    fallbackScope: params.scope,
  });
};
