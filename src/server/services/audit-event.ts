import { Prisma } from "@/generated/prisma/client";
import type { AuditLogEventType as PrismaAuditLogEventType, AuditLogSeverity as PrismaAuditLogSeverity } from "@/generated/prisma/client";

import type { AuditLogEventType, AuditLogSeverity } from "@/lib/audit-log";
import type { RequestContext } from "@/server/utils/request-context";

type Assert<T extends true> = T;
type IsEqual<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;

type _AuditLogEventTypeMatches = Assert<IsEqual<AuditLogEventType, PrismaAuditLogEventType>>;
type _AuditLogSeverityMatches = Assert<IsEqual<AuditLogSeverity, PrismaAuditLogSeverity>>;

export type TokenAuthMethod = "client_secret_basic" | "client_secret_post" | "none";

export type SecurityViolationReason =
  | "auth_method_mismatch"
  | "client_auth_invalid"
  | "client_auth_missing"
  | "client_mismatch"
  | "issuer_mismatch"
  | "pkce_method_unsupported"
  | "pkce_mismatch"
  | "redirect_uri_mismatch"
  | "state_mismatch"
  | "state_not_found"
  | "state_resource_mismatch";

export type TokenResponsePayload = {
  token_type?: string;
  scope?: string;
  expires_in?: number | string;
  access_token?: string;
  refresh_token?: string;
  id_token?: string;
};

export type TokenSummaryDetails = {
  tokenType?: string;
  scope?: string;
  expiresIn?: number;
  hasAccessToken: boolean;
  hasRefreshToken: boolean;
  hasIdToken: boolean;
};

export type AuthorizeReceivedDetails = {
  responseType: string;
  scope: string;
  prompt?: string;
  redirectUri?: string;
  state?: string;
  nonce?: string;
  codeChallenge?: string;
  codeChallengeMethod: string;
  loginHintProvided: boolean;
  loginHint?: string;
  nonceProvided: boolean;
  freshLoginRequested?: boolean;
};

export type ProxyRedirectOutDetails = {
  providerType: string;
  providerScope?: string;
  providerPkceEnabled: boolean;
  prompt?: string;
  loginHintProvided: boolean;
  redirectUri?: string;
  state?: string;
  nonce?: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
  codeVerifier?: string;
  loginHint?: string;
};

export type ProxyCallbackSuccessDetails = {
  providerType: string;
  tokenSummary: TokenSummaryDetails;
};

export type ProxyCallbackErrorDetails = {
  error: string;
  errorDescription?: string;
  providerType?: string;
  code?: string;
  rawError?: string;
  rawErrorDescription?: string;
};

export type ProxyCodeIssuedDetails = {
  scope: string;
  redirectUri: string;
};

export type TokenAuthCodeReceivedDetails = {
  authMethod: TokenAuthMethod;
  clientSecretInBody?: boolean;
  clientIdProvided?: boolean;
  clientId?: string | null;
  clientSecret?: string | null;
  grantType?: string;
  redirectUri?: string;
  authorizationCode?: string;
  includeAuthHeader?: boolean;
};

export type TokenRefreshReceivedDetails = {
  authMethod: TokenAuthMethod;
  clientSecretInBody?: boolean;
  scope?: string;
  clientId?: string | null;
  clientSecret?: string | null;
  grantType?: string;
  refreshToken?: string;
  includeAuthHeader?: boolean;
};

export type ProxyProviderConfigSnapshot = {
  providerType: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  userinfoEndpoint?: string;
  jwksUri?: string;
  upstreamClientId: string;
  upstreamClientSecret?: string;
  upstreamTokenEndpointAuthMethod?: TokenAuthMethod;
  defaultScopes?: string[];
  scopeMapping?: Record<string, string[]>;
  pkceSupported: boolean;
  oidcEnabled: boolean;
  promptPassthroughEnabled: boolean;
  loginHintPassthroughEnabled: boolean;
  passthroughTokenResponse: boolean;
};

export type ConfigChangedDetails = {
  action: string;
  resource: string;
  resourceId?: string;
  resourceName?: string;
  proxyConfigBefore?: ProxyProviderConfigSnapshot;
  proxyConfigAfter?: ProxyProviderConfigSnapshot;
  authMethodBefore?: TokenAuthMethod;
  authMethodAfter?: TokenAuthMethod;
};

export type SecurityViolationDetails = {
  reason: SecurityViolationReason;
  authMethod?: TokenAuthMethod;
  clientSecretInBody?: boolean;
  expectedAuthMethod?: TokenAuthMethod;
  receivedAuthMethod?: TokenAuthMethod;
  expectedClientId?: string;
  receivedClientId?: string;
  expectedRedirectUri?: string;
  receivedRedirectUri?: string;
  expectedApiResourceId?: string;
  receivedApiResourceId?: string;
  expectedCodeChallenge?: string;
  receivedCodeVerifier?: string;
  expectedCodeChallengeMethod?: string;
  receivedCodeChallengeMethod?: string;
  expectedState?: string;
  receivedState?: string;
  clientSecret?: string | null;
};

export type AuditEventDetailsMap = {
  AUTHORIZE_RECEIVED: AuthorizeReceivedDetails;
  PROXY_REDIRECT_OUT: ProxyRedirectOutDetails;
  PROXY_CALLBACK_SUCCESS: ProxyCallbackSuccessDetails;
  PROXY_CALLBACK_ERROR: ProxyCallbackErrorDetails;
  PROXY_CODE_ISSUED: ProxyCodeIssuedDetails;
  TOKEN_AUTHCODE_RECEIVED: TokenAuthCodeReceivedDetails;
  TOKEN_AUTHCODE_COMPLETED: TokenSummaryDetails;
  TOKEN_REFRESH_RECEIVED: TokenRefreshReceivedDetails;
  TOKEN_REFRESH_COMPLETED: TokenSummaryDetails;
  CONFIG_CHANGED: ConfigChangedDetails;
  SECURITY_VIOLATION: SecurityViolationDetails;
};

type AuditEventBase = {
  tenantId: string;
  clientId?: string | null;
  traceId?: string | null;
  actorId?: string | null;
  severity: AuditLogSeverity;
  message: string;
  requestContext?: RequestContext | null;
};

export type AuditEventInput = {
  [K in AuditLogEventType]: AuditEventBase & { eventType: K; details: AuditEventDetailsMap[K] };
}[AuditLogEventType];

export const buildAuthorizeReceivedDetails = (params: {
  responseType: string;
  scope: string;
  prompt?: string | null;
  redirectUri?: string | null;
  state?: string | null;
  nonce?: string | null;
  codeChallenge?: string | null;
  codeChallengeMethod: string;
  loginHint?: string | null;
  freshLoginRequested?: boolean;
}): AuthorizeReceivedDetails => ({
  responseType: params.responseType,
  scope: params.scope,
  prompt: params.prompt ?? undefined,
  redirectUri: params.redirectUri ?? undefined,
  state: params.state ?? undefined,
  nonce: params.nonce ?? undefined,
  codeChallenge: params.codeChallenge ?? undefined,
  codeChallengeMethod: params.codeChallengeMethod,
  loginHintProvided: Boolean(params.loginHint),
  loginHint: params.loginHint ?? undefined,
  nonceProvided: Boolean(params.nonce),
  freshLoginRequested: Boolean(params.freshLoginRequested),
});

export const buildProxyRedirectOutDetails = (params: {
  providerType: string;
  providerScope?: string | null;
  providerPkceEnabled: boolean;
  prompt?: string | null;
  loginHint?: string | null;
  redirectUri?: string | null;
  state?: string | null;
  nonce?: string | null;
  codeChallenge?: string | null;
  codeChallengeMethod?: string | null;
  codeVerifier?: string | null;
}): ProxyRedirectOutDetails => ({
  providerType: params.providerType,
  providerScope: params.providerScope ?? undefined,
  providerPkceEnabled: params.providerPkceEnabled,
  prompt: params.prompt ?? undefined,
  loginHintProvided: Boolean(params.loginHint),
  redirectUri: params.redirectUri ?? undefined,
  state: params.state ?? undefined,
  nonce: params.nonce ?? undefined,
  codeChallenge: params.codeChallenge ?? undefined,
  codeChallengeMethod: params.codeChallengeMethod ?? undefined,
  codeVerifier: params.codeVerifier ?? undefined,
  loginHint: params.loginHint ?? undefined,
});

export const buildProxyCallbackSuccessDetails = (params: {
  providerType: string;
  providerResponse: TokenResponsePayload;
}): ProxyCallbackSuccessDetails => ({
  providerType: params.providerType,
  tokenSummary: summarizeTokenResponse(params.providerResponse),
});

export const buildProxyCallbackErrorDetails = (params: {
  error: string;
  errorDescription?: string | null;
  providerType?: string | null;
  code?: string | null;
  rawError?: string | null;
  rawErrorDescription?: string | null;
}): ProxyCallbackErrorDetails => ({
  error: params.error,
  errorDescription: params.errorDescription ?? undefined,
  providerType: params.providerType ?? undefined,
  code: params.code ?? undefined,
  rawError: params.rawError ?? undefined,
  rawErrorDescription: params.rawErrorDescription ?? undefined,
});

export const buildProxyCodeIssuedDetails = (params: { scope: string; redirectUri: string }): ProxyCodeIssuedDetails => ({
  scope: params.scope,
  redirectUri: params.redirectUri,
});

export const buildTokenAuthCodeReceivedDetails = (params: TokenAuthCodeReceivedDetails): TokenAuthCodeReceivedDetails =>
  params;

export const buildTokenRefreshReceivedDetails = (params: TokenRefreshReceivedDetails): TokenRefreshReceivedDetails =>
  params;

export const buildConfigChangedDetails = (params: {
  action: string;
  resource: string;
  resourceId?: string | null;
  resourceName?: string | null;
  proxyConfigBefore?: ProxyProviderConfigSnapshot | null;
  proxyConfigAfter?: ProxyProviderConfigSnapshot | null;
  authMethodBefore?: TokenAuthMethod | null;
  authMethodAfter?: TokenAuthMethod | null;
}): ConfigChangedDetails => ({
  action: params.action,
  resource: params.resource,
  resourceId: params.resourceId ?? undefined,
  resourceName: params.resourceName ?? undefined,
  proxyConfigBefore: params.proxyConfigBefore ?? undefined,
  proxyConfigAfter: params.proxyConfigAfter ?? undefined,
  authMethodBefore: params.authMethodBefore ?? undefined,
  authMethodAfter: params.authMethodAfter ?? undefined,
});

export const buildSecurityViolationDetails = (params: SecurityViolationDetails): SecurityViolationDetails => ({
  reason: params.reason,
  authMethod: params.authMethod ?? undefined,
  clientSecretInBody: params.clientSecretInBody ?? undefined,
  expectedAuthMethod: params.expectedAuthMethod ?? undefined,
  receivedAuthMethod: params.receivedAuthMethod ?? undefined,
  expectedClientId: params.expectedClientId ?? undefined,
  receivedClientId: params.receivedClientId ?? undefined,
  expectedRedirectUri: params.expectedRedirectUri ?? undefined,
  receivedRedirectUri: params.receivedRedirectUri ?? undefined,
  expectedApiResourceId: params.expectedApiResourceId ?? undefined,
  receivedApiResourceId: params.receivedApiResourceId ?? undefined,
  expectedCodeChallenge: params.expectedCodeChallenge ?? undefined,
  receivedCodeVerifier: params.receivedCodeVerifier ?? undefined,
  expectedCodeChallengeMethod: params.expectedCodeChallengeMethod ?? undefined,
  receivedCodeChallengeMethod: params.receivedCodeChallengeMethod ?? undefined,
  expectedState: params.expectedState ?? undefined,
  receivedState: params.receivedState ?? undefined,
  clientSecret: params.clientSecret,
});

const parseExpiresIn = (value: TokenResponsePayload["expires_in"]) => {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return undefined;
    }
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
};

export const summarizeTokenResponse = (response: TokenResponsePayload): TokenSummaryDetails => ({
  tokenType: response.token_type?.trim() || undefined,
  scope: response.scope?.trim() || undefined,
  expiresIn: parseExpiresIn(response.expires_in),
  hasAccessToken: typeof response.access_token === "string",
  hasRefreshToken: typeof response.refresh_token === "string",
  hasIdToken: typeof response.id_token === "string",
});

export const toTokenResponsePayload = (response: Record<string, unknown>): TokenResponsePayload => ({
  token_type: typeof response.token_type === "string" ? response.token_type : undefined,
  scope: typeof response.scope === "string" ? response.scope : undefined,
  expires_in:
    typeof response.expires_in === "number" || typeof response.expires_in === "string"
      ? response.expires_in
      : undefined,
  access_token: typeof response.access_token === "string" ? response.access_token : undefined,
  refresh_token: typeof response.refresh_token === "string" ? response.refresh_token : undefined,
  id_token: typeof response.id_token === "string" ? response.id_token : undefined,
});

const compactDetails = (value: Record<string, unknown>): Prisma.InputJsonObject | null => {
  const entries = Object.entries(value).filter(([, entry]) => entry !== undefined);
  return entries.length > 0 ? (Object.fromEntries(entries) as Prisma.InputJsonObject) : null;
};

const parseUrlHost = (value: string) => {
  try {
    return new URL(value).host;
  } catch {
    return undefined;
  }
};

export const sanitizeAuditDetails = (
  event: AuditEventInput,
  options?: { redactionEnabled?: boolean },
): Prisma.InputJsonValue | null => {
  const redactionEnabled = options?.redactionEnabled !== false;
  switch (event.eventType) {
    case "AUTHORIZE_RECEIVED":
      if (redactionEnabled) {
        return compactDetails({
          responseType: event.details.responseType,
          scope: event.details.scope,
          prompt: event.details.prompt,
          codeChallengeMethod: event.details.codeChallengeMethod,
          loginHintProvided: event.details.loginHintProvided,
          nonceProvided: event.details.nonceProvided,
          freshLoginRequested: event.details.freshLoginRequested,
        });
      }
      return compactDetails({
        responseType: event.details.responseType,
        scope: event.details.scope,
        prompt: event.details.prompt,
        redirectUri: event.details.redirectUri,
        state: event.details.state,
        nonce: event.details.nonce,
        codeChallenge: event.details.codeChallenge,
        codeChallengeMethod: event.details.codeChallengeMethod,
        loginHintProvided: event.details.loginHintProvided,
        loginHint: event.details.loginHint,
        nonceProvided: event.details.nonceProvided,
        freshLoginRequested: event.details.freshLoginRequested,
      });
    case "PROXY_REDIRECT_OUT":
      if (redactionEnabled) {
        return compactDetails({
          providerType: event.details.providerType,
          providerScope: event.details.providerScope,
          providerPkceEnabled: event.details.providerPkceEnabled,
          prompt: event.details.prompt,
          loginHintProvided: event.details.loginHintProvided,
        });
      }
      return compactDetails({
        providerType: event.details.providerType,
        providerScope: event.details.providerScope,
        providerPkceEnabled: event.details.providerPkceEnabled,
        prompt: event.details.prompt,
        loginHintProvided: event.details.loginHintProvided,
        redirectUri: event.details.redirectUri,
        state: event.details.state,
        nonce: event.details.nonce,
        codeChallenge: event.details.codeChallenge,
        codeChallengeMethod: event.details.codeChallengeMethod,
        codeVerifier: event.details.codeVerifier,
        loginHint: event.details.loginHint,
      });
    case "PROXY_CALLBACK_SUCCESS":
      return compactDetails({
        providerType: event.details.providerType,
        ...event.details.tokenSummary,
      });
    case "PROXY_CALLBACK_ERROR":
      return compactDetails({
        error: redactionEnabled ? event.details.error : event.details.rawError ?? event.details.error,
        errorDescription: redactionEnabled
          ? event.details.errorDescription
          : event.details.rawErrorDescription ?? event.details.errorDescription,
        providerType: event.details.providerType,
        code: redactionEnabled ? undefined : event.details.code,
      });
    case "PROXY_CODE_ISSUED":
      return compactDetails({
        scope: event.details.scope,
        redirectUriHost: parseUrlHost(event.details.redirectUri),
      });
    case "TOKEN_AUTHCODE_RECEIVED":
      if (redactionEnabled) {
        return compactDetails({
          authMethod: event.details.authMethod,
          clientSecretInBody: event.details.clientSecretInBody,
          clientIdProvided: event.details.clientIdProvided,
        });
      }
      return compactDetails({
        authMethod: event.details.authMethod,
        clientSecretInBody: event.details.clientSecretInBody,
        clientIdProvided: event.details.clientIdProvided,
        clientId: event.details.clientId,
        clientSecret: event.details.clientSecret,
        grantType: event.details.grantType,
        redirectUri: event.details.redirectUri,
        authorizationCode: event.details.authorizationCode,
        includeAuthHeader: event.details.includeAuthHeader,
      });
    case "TOKEN_AUTHCODE_COMPLETED":
      return compactDetails(event.details);
    case "TOKEN_REFRESH_RECEIVED":
      if (redactionEnabled) {
        return compactDetails({
          authMethod: event.details.authMethod,
          clientSecretInBody: event.details.clientSecretInBody,
          scope: event.details.scope,
        });
      }
      return compactDetails({
        authMethod: event.details.authMethod,
        clientSecretInBody: event.details.clientSecretInBody,
        scope: event.details.scope,
        clientId: event.details.clientId,
        clientSecret: event.details.clientSecret,
        grantType: event.details.grantType,
        refreshToken: event.details.refreshToken,
        includeAuthHeader: event.details.includeAuthHeader,
      });
    case "TOKEN_REFRESH_COMPLETED":
      return compactDetails(event.details);
    case "CONFIG_CHANGED":
      if (redactionEnabled) {
        return compactDetails({
          action: event.details.action,
          resource: event.details.resource,
          resourceId: event.details.resourceId,
          resourceName: event.details.resourceName,
        });
      }
      return compactDetails({
        action: event.details.action,
        resource: event.details.resource,
        resourceId: event.details.resourceId,
        resourceName: event.details.resourceName,
        proxyConfigBefore: event.details.proxyConfigBefore,
        proxyConfigAfter: event.details.proxyConfigAfter,
        authMethodBefore: event.details.authMethodBefore,
        authMethodAfter: event.details.authMethodAfter,
      });
    case "SECURITY_VIOLATION":
      if (redactionEnabled) {
        return compactDetails({
          reason: event.details.reason,
          authMethod: event.details.authMethod ?? undefined,
          clientSecretInBody: event.details.clientSecretInBody ?? undefined,
        });
      }
      return compactDetails({
        ...event.details,
      });
    default: {
      const _exhaustive: never = event;
      throw new Error(`Unhandled audit event type: ${_exhaustive}`);
    }
  }
};
