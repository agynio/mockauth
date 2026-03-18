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
  codeChallengeMethod: string;
  loginHintProvided: boolean;
  nonceProvided: boolean;
  freshLoginRequested?: boolean;
};

export type ProxyRedirectOutDetails = {
  providerType: string;
  providerScope?: string;
  providerPkceEnabled: boolean;
  prompt?: string;
  loginHintProvided: boolean;
};

export type ProxyCallbackSuccessDetails = {
  providerType: string;
  tokenSummary: TokenSummaryDetails;
};

export type ProxyCallbackErrorDetails = {
  error: string;
  errorDescription?: string;
  providerType?: string;
};

export type ProxyCodeIssuedDetails = {
  scope: string;
  redirectUri: string;
};

export type TokenAuthCodeReceivedDetails = {
  authMethod: TokenAuthMethod;
  clientSecretInBody?: boolean;
  clientIdProvided?: boolean;
};

export type TokenRefreshReceivedDetails = {
  authMethod: TokenAuthMethod;
  clientSecretInBody?: boolean;
  scope?: string;
};

export type ConfigChangedDetails = {
  action: string;
  resource: string;
  resourceId?: string;
  resourceName?: string;
};

export type SecurityViolationDetails = {
  reason: SecurityViolationReason;
  authMethod?: TokenAuthMethod;
  clientSecretInBody?: boolean;
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
  codeChallengeMethod: string;
  loginHint?: string | null;
  nonce?: string | null;
  freshLoginRequested?: boolean;
}): AuthorizeReceivedDetails => ({
  responseType: params.responseType,
  scope: params.scope,
  prompt: params.prompt ?? undefined,
  codeChallengeMethod: params.codeChallengeMethod,
  loginHintProvided: Boolean(params.loginHint),
  nonceProvided: Boolean(params.nonce),
  freshLoginRequested: Boolean(params.freshLoginRequested),
});

export const buildProxyRedirectOutDetails = (params: {
  providerType: string;
  providerScope?: string | null;
  providerPkceEnabled: boolean;
  prompt?: string | null;
  loginHint?: string | null;
}): ProxyRedirectOutDetails => ({
  providerType: params.providerType,
  providerScope: params.providerScope ?? undefined,
  providerPkceEnabled: params.providerPkceEnabled,
  prompt: params.prompt ?? undefined,
  loginHintProvided: Boolean(params.loginHint),
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
}): ProxyCallbackErrorDetails => ({
  error: params.error,
  errorDescription: params.errorDescription ?? undefined,
  providerType: params.providerType ?? undefined,
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
}): ConfigChangedDetails => ({
  action: params.action,
  resource: params.resource,
  resourceId: params.resourceId ?? undefined,
  resourceName: params.resourceName ?? undefined,
});

export const buildSecurityViolationDetails = (params: SecurityViolationDetails): SecurityViolationDetails => ({
  reason: params.reason,
  authMethod: params.authMethod ?? undefined,
  clientSecretInBody: params.clientSecretInBody ?? undefined,
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

export const sanitizeAuditDetails = (event: AuditEventInput): Prisma.InputJsonValue | null => {
  switch (event.eventType) {
    case "AUTHORIZE_RECEIVED":
      return compactDetails({
        responseType: event.details.responseType,
        scope: event.details.scope,
        prompt: event.details.prompt,
        codeChallengeMethod: event.details.codeChallengeMethod,
        loginHintProvided: event.details.loginHintProvided,
        nonceProvided: event.details.nonceProvided,
        freshLoginRequested: event.details.freshLoginRequested,
      });
    case "PROXY_REDIRECT_OUT":
      return compactDetails({
        providerType: event.details.providerType,
        providerScope: event.details.providerScope,
        providerPkceEnabled: event.details.providerPkceEnabled,
        prompt: event.details.prompt,
        loginHintProvided: event.details.loginHintProvided,
      });
    case "PROXY_CALLBACK_SUCCESS":
      return compactDetails({
        providerType: event.details.providerType,
        ...event.details.tokenSummary,
      });
    case "PROXY_CALLBACK_ERROR":
      return compactDetails({
        error: event.details.error,
        errorDescription: event.details.errorDescription,
        providerType: event.details.providerType,
      });
    case "PROXY_CODE_ISSUED":
      return compactDetails({
        scope: event.details.scope,
        redirectUriHost: parseUrlHost(event.details.redirectUri),
      });
    case "TOKEN_AUTHCODE_RECEIVED":
      return compactDetails({
        authMethod: event.details.authMethod,
        clientSecretInBody: event.details.clientSecretInBody,
        clientIdProvided: event.details.clientIdProvided,
      });
    case "TOKEN_AUTHCODE_COMPLETED":
      return compactDetails(event.details);
    case "TOKEN_REFRESH_RECEIVED":
      return compactDetails({
        authMethod: event.details.authMethod,
        clientSecretInBody: event.details.clientSecretInBody,
        scope: event.details.scope,
      });
    case "TOKEN_REFRESH_COMPLETED":
      return compactDetails(event.details);
    case "CONFIG_CHANGED":
      return compactDetails({
        action: event.details.action,
        resource: event.details.resource,
        resourceId: event.details.resourceId,
        resourceName: event.details.resourceName,
      });
    case "SECURITY_VIOLATION":
      return compactDetails({
        reason: event.details.reason,
        authMethod: event.details.authMethod ?? undefined,
        clientSecretInBody: event.details.clientSecretInBody ?? undefined,
      });
    default: {
      const _exhaustive: never = event;
      throw new Error(`Unhandled audit event type: ${_exhaustive}`);
    }
  }
};
