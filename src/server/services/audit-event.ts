import { Prisma } from "@/generated/prisma/client";
import type { AuditLogEventType as PrismaAuditLogEventType, AuditLogSeverity as PrismaAuditLogSeverity } from "@/generated/prisma/client";

import type { AuditLogEventType, AuditLogSeverity } from "@/lib/audit-log";
import type { TokenAuthMethod } from "@/server/oidc/token-auth-method";
import type { RequestContext } from "@/server/utils/request-context";

type Assert<T extends true> = T;
type IsEqual<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;

type _AuditLogEventTypeMatches = Assert<IsEqual<AuditLogEventType, PrismaAuditLogEventType>>;
type _AuditLogSeverityMatches = Assert<IsEqual<AuditLogSeverity, PrismaAuditLogSeverity>>;

export type { TokenAuthMethod } from "@/server/oidc/token-auth-method";

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
  diagnostics?: ProxyFlowDiagnostics;
  upstreamCall?: boolean;
};

export type AuthorizeReceivedDetails = {
  responseType: string;
  scope: string;
  prompt?: string;
  codeChallengeMethod: string;
  loginHintProvided: boolean;
  nonceProvided: boolean;
  freshLoginRequested?: boolean;
  redirectUri?: string;
  state?: string;
  nonce?: string;
  codeChallenge?: string;
  loginHint?: string;
};

export type ProxyRedirectOutDetails = {
  providerType: string;
  providerScope?: string;
  providerPkceEnabled: boolean;
  providerAuthorizationUrl: string;
  providerAuthorizationParams: Record<string, string | string[]>;
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
  tokenResponse: TokenResponsePayload;
  diagnostics?: ProxyFlowDiagnostics;
};

export type ProviderTokenExchangeDiagnostics = {
  tokenEndpointHost: string;
  authMethod: TokenAuthMethod;
  includeAuthHeader: boolean;
  includeClientSecretInBody: boolean;
  client_id: string;
  redirect_uri?: string;
  grant_type: string;
  code_verifier_present?: boolean;
};

export type ProxyCallbackErrorDetails = {
  error: string;
  errorDescription?: string;
  providerType?: string;
  code?: string;
  diagnostics?: ProxyFlowDiagnostics;
} & Partial<ProviderTokenExchangeDiagnostics>;

export type ProxyFlowStage = "callback" | "token";

export type ProxyFlowRequestDetails = {
  url: string;
  headers: Record<string, string>;
  contentType: string | null;
  body: string | null;
};

export type ProxyFlowResponseDetails = {
  status: number | null;
  headers: Record<string, string>;
  body: string | null;
};

export type ProxyFlowDiagnostics = {
  stage: ProxyFlowStage;
  request: ProxyFlowRequestDetails;
  response: ProxyFlowResponseDetails;
  params: Record<string, string | string[]>;
  meta: {
    clientId: string | null;
    traceId: string | null;
  };
};

export type TokenAuthCodeErrorDetails = ProviderTokenExchangeDiagnostics & {
  error: string;
  errorDescription?: string;
  diagnostics?: ProxyFlowDiagnostics;
  upstreamCall?: boolean;
};

export type TokenAuthCodeCompletedDetails =
  | (TokenResponsePayload & {
      upstreamCall?: boolean;
      providerResponse?: Record<string, unknown>;
    })
  | TokenAuthCodeErrorDetails;

export type ProxyCodeIssuedDetails = {
  scope: string;
  redirectUri: string;
  issued: boolean;
  authorizationCode?: string | null;
};

export type PreauthorizedIdentityDetails = {
  identityId: string;
  label?: string;
  providerSubject: string;
  providerEmail?: string;
  providerScope?: string;
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
  diagnostics?: ProxyFlowDiagnostics;
  upstreamCall?: boolean;
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
  diagnostics?: ProxyFlowDiagnostics;
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
  authMethodsBefore?: TokenAuthMethod[];
  authMethodsAfter?: TokenAuthMethod[];
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
  PREAUTHORIZED_ADMIN_REDIRECT_OUT: ProxyRedirectOutDetails;
  PREAUTHORIZED_ADMIN_CALLBACK_SUCCESS: ProxyCallbackSuccessDetails;
  PREAUTHORIZED_ADMIN_CALLBACK_ERROR: ProxyCallbackErrorDetails;
  PREAUTHORIZED_CODE_ISSUED: ProxyCodeIssuedDetails;
  PREAUTHORIZED_IDENTITY_SELECTED: PreauthorizedIdentityDetails;
  PREAUTHORIZED_IDENTITY_DELETED: PreauthorizedIdentityDetails;
  PREAUTHORIZED_TOKEN_REFRESH_SUCCESS: ProxyCallbackSuccessDetails;
  PREAUTHORIZED_TOKEN_REFRESH_FAILED: ProxyCallbackErrorDetails;
  TOKEN_AUTHCODE_RECEIVED: TokenAuthCodeReceivedDetails;
  TOKEN_AUTHCODE_COMPLETED: TokenAuthCodeCompletedDetails;
  TOKEN_REFRESH_RECEIVED: TokenRefreshReceivedDetails;
  TOKEN_REFRESH_COMPLETED: TokenResponsePayload;
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

type AuthorizeReceivedDetailsParams = {
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
};

export function buildAuthorizeReceivedDetails(params: AuthorizeReceivedDetailsParams): AuthorizeReceivedDetails {
  return {
    responseType: params.responseType,
    scope: params.scope,
    prompt: params.prompt ?? undefined,
    codeChallengeMethod: params.codeChallengeMethod,
    loginHintProvided: Boolean(params.loginHint),
    nonceProvided: Boolean(params.nonce),
    freshLoginRequested: Boolean(params.freshLoginRequested),
    redirectUri: params.redirectUri ?? undefined,
    state: params.state ?? undefined,
    nonce: params.nonce ?? undefined,
    codeChallenge: params.codeChallenge ?? undefined,
    loginHint: params.loginHint ?? undefined,
  };
}

type ProxyRedirectOutDetailsParams = {
  providerType: string;
  providerScope?: string | null;
  providerPkceEnabled: boolean;
  providerAuthorizationUrl: string;
  providerAuthorizationParams: Record<string, string | string[]>;
  prompt?: string | null;
  loginHint?: string | null;
  redirectUri?: string | null;
  state?: string | null;
  nonce?: string | null;
  codeChallenge?: string | null;
  codeChallengeMethod?: string | null;
  codeVerifier?: string | null;
};

export function buildProxyRedirectOutDetails(params: ProxyRedirectOutDetailsParams): ProxyRedirectOutDetails {
  return {
    providerType: params.providerType,
    providerScope: params.providerScope ?? undefined,
    providerPkceEnabled: params.providerPkceEnabled,
    providerAuthorizationUrl: params.providerAuthorizationUrl,
    providerAuthorizationParams: params.providerAuthorizationParams,
    prompt: params.prompt ?? undefined,
    loginHintProvided: Boolean(params.loginHint),
    redirectUri: params.redirectUri ?? undefined,
    state: params.state ?? undefined,
    nonce: params.nonce ?? undefined,
    codeChallenge: params.codeChallenge ?? undefined,
    codeChallengeMethod: params.codeChallengeMethod ?? undefined,
    codeVerifier: params.codeVerifier ?? undefined,
    loginHint: params.loginHint ?? undefined,
  };
}

export const buildProxyCallbackSuccessDetails = (params: {
  providerType: string;
  providerResponse: TokenResponsePayload;
  diagnostics?: ProxyFlowDiagnostics;
}): ProxyCallbackSuccessDetails => ({
  providerType: params.providerType,
  tokenResponse: params.providerResponse,
  diagnostics: params.diagnostics ?? undefined,
});

type ProxyFlowDiagnosticsParams = {
  stage: ProxyFlowStage;
  request: ProxyFlowRequestDetails;
  response?: Partial<ProxyFlowResponseDetails> | null;
  params: Record<string, string | string[]>;
  meta: {
    clientId?: string | null;
    traceId?: string | null;
  };
};

export const buildProxyFlowDiagnostics = (params: ProxyFlowDiagnosticsParams): ProxyFlowDiagnostics => ({
  stage: params.stage,
  request: {
    url: params.request.url,
    headers: params.request.headers,
    contentType: params.request.contentType ?? null,
    body: params.request.body ?? null,
  },
  response: {
    status: params.response?.status ?? null,
    headers: params.response?.headers ?? {},
    body: params.response?.body ?? null,
  },
  params: params.params,
  meta: {
    clientId: params.meta.clientId ?? null,
    traceId: params.meta.traceId ?? null,
  },
});

type ProxyCallbackErrorDetailsParams = {
  error: string;
  errorDescription?: string | null;
  providerType?: string | null;
  code?: string | null;
  rawError?: string | null;
  rawErrorDescription?: string | null;
  diagnostics?: ProxyFlowDiagnostics;
} & Partial<ProviderTokenExchangeDiagnostics>;

export function buildProxyCallbackErrorDetails(params: ProxyCallbackErrorDetailsParams): ProxyCallbackErrorDetails {
  const { rawError, rawErrorDescription, error, errorDescription, providerType, code, diagnostics, ...exchangeDetails } =
    params;
  return {
    error: rawError ?? error,
    errorDescription: rawErrorDescription ?? errorDescription ?? undefined,
    providerType: providerType ?? undefined,
    code: code ?? undefined,
    diagnostics: diagnostics ?? undefined,
    ...exchangeDetails,
  };
}

type ProviderTokenExchangeDiagnosticsParams = {
  tokenEndpoint: string;
  authMethod: TokenAuthMethod;
  clientId: string;
  grantType: string;
  redirectUri?: string | null;
  codeVerifierPresent?: boolean | null;
};

export function buildProviderTokenExchangeDiagnostics(
  params: ProviderTokenExchangeDiagnosticsParams,
): ProviderTokenExchangeDiagnostics {
  return {
    tokenEndpointHost: new URL(params.tokenEndpoint).host,
    authMethod: params.authMethod,
    includeAuthHeader: params.authMethod === "client_secret_basic",
    includeClientSecretInBody: params.authMethod === "client_secret_post",
    client_id: params.clientId,
    redirect_uri: params.redirectUri ?? undefined,
    grant_type: params.grantType,
    code_verifier_present: params.codeVerifierPresent ?? undefined,
  };
}

type TokenAuthCodeErrorDetailsParams = {
  error: string;
  errorDescription?: string | null;
  exchangeDiagnostics: ProviderTokenExchangeDiagnostics;
  diagnostics?: ProxyFlowDiagnostics;
  upstreamCall?: boolean;
};

export function buildTokenAuthCodeErrorDetails(params: TokenAuthCodeErrorDetailsParams): TokenAuthCodeErrorDetails {
  return {
    error: params.error,
    errorDescription: params.errorDescription ?? undefined,
    diagnostics: params.diagnostics ?? undefined,
    upstreamCall: params.upstreamCall ?? undefined,
    ...params.exchangeDiagnostics,
  };
}

export const buildProxyCodeIssuedDetails = (params: {
  scope: string;
  redirectUri: string;
  issued: boolean;
  authorizationCode?: string | null;
}): ProxyCodeIssuedDetails => ({
  scope: params.scope,
  redirectUri: params.redirectUri,
  issued: params.issued,
  authorizationCode: params.authorizationCode ?? null,
});

export const buildPreauthorizedIdentityDetails = (params: {
  identityId: string;
  label?: string | null;
  providerSubject: string;
  providerEmail?: string | null;
  providerScope?: string | null;
}): PreauthorizedIdentityDetails => ({
  identityId: params.identityId,
  label: params.label ?? undefined,
  providerSubject: params.providerSubject,
  providerEmail: params.providerEmail ?? undefined,
  providerScope: params.providerScope ?? undefined,
});

type TokenAuthCodeReceivedParams = {
  authMethod: TokenAuthMethod;
  clientSecretInBody?: boolean;
  clientIdProvided?: boolean;
  clientId?: string | null;
  clientSecret?: string | null;
  grantType?: string;
  redirectUri?: string;
  authorizationCode?: string;
  includeAuthHeader?: boolean;
  diagnostics?: ProxyFlowDiagnostics;
  upstreamCall?: boolean;
};

export function buildTokenAuthCodeReceivedDetails(
  params: TokenAuthCodeReceivedParams,
): TokenAuthCodeReceivedDetails {
  return {
    authMethod: params.authMethod,
    clientSecretInBody: params.clientSecretInBody ?? undefined,
    clientIdProvided: params.clientIdProvided ?? undefined,
    clientId: params.clientId ?? null,
    clientSecret: params.clientSecret ?? null,
    grantType: params.grantType ?? undefined,
    redirectUri: params.redirectUri ?? undefined,
    authorizationCode: params.authorizationCode ?? undefined,
    includeAuthHeader: params.includeAuthHeader ?? undefined,
    diagnostics: params.diagnostics ?? undefined,
    upstreamCall: params.upstreamCall ?? undefined,
  };
}

type TokenRefreshReceivedParams = {
  authMethod: TokenAuthMethod;
  clientSecretInBody?: boolean;
  scope?: string;
  clientId?: string | null;
  clientSecret?: string | null;
  grantType?: string;
  refreshToken?: string;
  includeAuthHeader?: boolean;
  diagnostics?: ProxyFlowDiagnostics;
};

export function buildTokenRefreshReceivedDetails(params: TokenRefreshReceivedParams): TokenRefreshReceivedDetails {
  return {
    authMethod: params.authMethod,
    clientSecretInBody: params.clientSecretInBody ?? undefined,
    scope: params.scope ?? undefined,
    clientId: params.clientId ?? null,
    clientSecret: params.clientSecret ?? null,
    grantType: params.grantType ?? undefined,
    refreshToken: params.refreshToken ?? undefined,
    includeAuthHeader: params.includeAuthHeader ?? undefined,
    diagnostics: params.diagnostics ?? undefined,
  };
}

type ConfigChangedDetailsParams = {
  action: string;
  resource: string;
  resourceId?: string | null;
  resourceName?: string | null;
  proxyConfigBefore?: ProxyProviderConfigSnapshot | null;
  proxyConfigAfter?: ProxyProviderConfigSnapshot | null;
  authMethodBefore?: TokenAuthMethod | null;
  authMethodAfter?: TokenAuthMethod | null;
  authMethodsBefore?: TokenAuthMethod[] | null;
  authMethodsAfter?: TokenAuthMethod[] | null;
};

export function buildConfigChangedDetails(params: ConfigChangedDetailsParams): ConfigChangedDetails {
  return {
    action: params.action,
    resource: params.resource,
    resourceId: params.resourceId ?? undefined,
    resourceName: params.resourceName ?? undefined,
    proxyConfigBefore: params.proxyConfigBefore ?? undefined,
    proxyConfigAfter: params.proxyConfigAfter ?? undefined,
    authMethodBefore: params.authMethodBefore ?? undefined,
    authMethodAfter: params.authMethodAfter ?? undefined,
    authMethodsBefore: params.authMethodsBefore ?? undefined,
    authMethodsAfter: params.authMethodsAfter ?? undefined,
  };
}

type SecurityViolationDetailsParams = {
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

export function buildSecurityViolationDetails(params: SecurityViolationDetailsParams): SecurityViolationDetails {
  return {
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
  };
}

export const toTokenResponsePayload = (
  response: Record<string, unknown>,
  diagnostics?: ProxyFlowDiagnostics,
): TokenResponsePayload => ({
  token_type: typeof response.token_type === "string" ? response.token_type : undefined,
  scope: typeof response.scope === "string" ? response.scope : undefined,
  expires_in:
    typeof response.expires_in === "number" || typeof response.expires_in === "string"
      ? response.expires_in
      : undefined,
  access_token: typeof response.access_token === "string" ? response.access_token : undefined,
  refresh_token: typeof response.refresh_token === "string" ? response.refresh_token : undefined,
  id_token: typeof response.id_token === "string" ? response.id_token : undefined,
  diagnostics: diagnostics ?? undefined,
});

const compactDetails = (value: Record<string, unknown>): Prisma.InputJsonObject | null => {
  const entries = Object.entries(value).filter(([, entry]) => entry !== undefined);
  return entries.length > 0 ? (Object.fromEntries(entries) as Prisma.InputJsonObject) : null;
};

export const sanitizeAuditDetails = (event: AuditEventInput): Prisma.InputJsonValue | null =>
  compactDetails(event.details as Record<string, unknown>);
