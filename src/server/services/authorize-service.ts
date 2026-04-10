import { randomUUID } from "node:crypto";

import { DomainError } from "@/server/errors";
import { resolveRedirectUri } from "@/server/oidc/redirect-uri";
import { createAuthorizationCode } from "@/server/services/authorization-code-service";
import { getSessionUser } from "@/server/services/mock-session-service";
import { getClientForTenant } from "@/server/services/client-service";
import { getApiResourceWithTenant } from "@/server/services/api-resource-service";
import { fromPrismaLoginStrategy, parseClientAuthStrategies, type ClientAuthStrategy } from "@/server/oidc/auth-strategy";
import {
  enabledProxyStrategies,
  parseProxyAuthStrategies,
  type ProxyAuthStrategy,
} from "@/server/oidc/proxy-auth-strategy";
import { normalizeScopes } from "@/server/oidc/scopes";
import { verifyFreshLoginCookieValue, verifyReauthCookieValue } from "@/server/oidc/reauth-cookie";
import { hashOpaqueToken, generateOpaqueToken } from "@/server/crypto/opaque-token";
import { computeS256Challenge } from "@/server/crypto/pkce";
import { emitAuditEvent } from "@/server/services/audit-service";
import { buildAuthorizeReceivedDetails, buildProxyRedirectOutDetails } from "@/server/services/audit-event";
import {
  PROXY_TRANSACTION_TTL_SECONDS,
  startProxyAuthTransaction,
  deleteProxyAuthTransaction,
} from "@/server/services/proxy-service";
import { PROXY_TRANSACTION_COOKIE, buildProxyTransactionCookiePath } from "@/server/oidc/proxy/constants";
import { mapAppScopesToProvider } from "@/server/oidc/proxy/scope-mapping";
import { PREAUTHORIZED_PICKER_COOKIE, buildPreauthorizedPickerCookiePath } from "@/server/oidc/preauthorized/constants";
import {
  PREAUTHORIZED_PICKER_TTL_SECONDS,
  startPickerTransaction,
} from "@/server/services/preauthorized-picker-service";
import { searchParamsToRecord } from "@/server/utils/search-params";
import type { RequestContext } from "@/server/utils/request-context";

type LoadedClient = Awaited<ReturnType<typeof getClientForTenant>>;
type AuthorizeParams = {
  apiResourceId: string;
  clientId: string;
  redirectUri: string;
  responseType: string;
  scope: string;
  state?: string;
  nonce?: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
  prompt?: string;
  loginHint?: string;
  authStrategy?: string;
  sessionToken?: string;
  reauthCookie?: string;
  freshLoginCookie?: string;
  freshLoginRequested?: boolean;
};

type CookieInstruction = {
  name: string;
  value: string;
  options: {
    path: string;
    httpOnly: boolean;
    sameSite: "lax" | "strict" | "none";
    secure: boolean;
    maxAge?: number;
  };
};

type AuthorizeResult =
  | { type: "login"; redirectTo: string; consumeFreshLoginCookie?: boolean; cookies?: CookieInstruction[] }
  | { type: "redirect"; redirectTo: string; consumeFreshLoginCookie?: boolean; cookies?: CookieInstruction[] };

const ensureScopes = (requestedScopes: string[], allowedScopes: string[]) => {
  const requested = normalizeScopes(requestedScopes);
  const allowed = new Set(normalizeScopes(allowedScopes));

  if (!requested.includes("openid")) {
    throw new DomainError("scope must include openid", { status: 400, code: "invalid_scope" });
  }

  const notAllowed = requested.filter((scope) => !allowed.has(scope));
  if (notAllowed.length > 0) {
    throw new DomainError(`Client does not allow scopes: ${notAllowed.join(", ")}`, {
      status: 400,
      code: "invalid_scope",
    });
  }
};

const isProxyAuthStrategy = (value: string | undefined): value is ProxyAuthStrategy =>
  value === "redirect" || value === "preauthorized";

const isClientAuthStrategy = (value: string | undefined): value is ClientAuthStrategy =>
  value === "username" || value === "email";

export const handleAuthorize = async (
  params: AuthorizeParams,
  origin: string,
  returnTo: string,
  requestContext?: RequestContext,
): Promise<AuthorizeResult> => {
  if (params.responseType !== "code") {
    throw new DomainError("Only response_type=code is supported", { status: 400, code: "unsupported_response_type" });
  }

  const { tenant, resource } = await getApiResourceWithTenant(params.apiResourceId);
  const client = await getClientForTenant(tenant.id, params.clientId);
  const clientResourceId = client.apiResourceId ?? tenant.defaultApiResourceId;
  if (clientResourceId !== resource.id) {
    throw new DomainError("Client is not configured for this issuer", { status: 400, code: "invalid_client" });
  }

  const buildLoginRedirect = (): AuthorizeResult => ({
    type: "login",
    redirectTo: `/r/${resource.id}/oidc/login?return_to=${encodeURIComponent(new URL(returnTo).toString())}`,
  });

  const codeChallengeMethod = params.codeChallengeMethod ?? "S256";
  let resolvedCodeChallenge = "";
  let resolvedCodeChallengeMethod = "S256";
  if (client.pkceRequired) {
    const codeChallenge = params.codeChallenge;
    if (!codeChallenge) {
      throw new DomainError("code_challenge is required", { status: 400, code: "invalid_request" });
    }
    if (codeChallengeMethod !== "S256") {
      throw new DomainError("Only PKCE S256 is supported", { status: 400, code: "invalid_request" });
    }
    resolvedCodeChallenge = codeChallenge;
    resolvedCodeChallengeMethod = codeChallengeMethod;
  }
  const resolvedParams = {
    ...params,
    codeChallenge: resolvedCodeChallenge,
    codeChallengeMethod: resolvedCodeChallengeMethod,
  };
  const auditCodeChallenge = client.pkceRequired ? resolvedCodeChallenge : undefined;

  if (client.oauthClientMode === "proxy") {
    const proxyAuthStrategies = parseProxyAuthStrategies(client.proxyAuthStrategies);
    const enabledStrategies = enabledProxyStrategies(proxyAuthStrategies);
    if (enabledStrategies.length === 0) {
      throw new DomainError("At least one proxy auth strategy must be enabled", { status: 400, code: "invalid_client" });
    }
    const requestedStrategy = params.authStrategy;
    let strategy: ProxyAuthStrategy | null = null;
    if (requestedStrategy) {
      if (!isProxyAuthStrategy(requestedStrategy)) {
        throw new DomainError("Requested auth strategy is not valid for proxy clients", {
          status: 400,
          code: "invalid_request",
        });
      }
      if (!enabledStrategies.includes(requestedStrategy)) {
        throw new DomainError("Requested proxy strategy is not enabled", { status: 400, code: "invalid_request" });
      }
      strategy = requestedStrategy;
    } else if (enabledStrategies.length === 1) {
      strategy = enabledStrategies[0] ?? null;
    }

    if (!strategy) {
      const redirect = resolveRedirectUri(resolvedParams.redirectUri, client.redirectUris ?? []);
      ensureScopes(resolvedParams.scope.split(" ").filter(Boolean), client.allowedScopes);
      const traceId = randomUUID();
      void emitAuditEvent({
        tenantId: tenant.id,
        clientId: client.id,
        traceId,
        actorId: null,
        eventType: "AUTHORIZE_RECEIVED",
        severity: "INFO",
        message: "Proxy authorization request received",
        details: buildAuthorizeReceivedDetails({
          responseType: resolvedParams.responseType,
          scope: resolvedParams.scope,
          prompt: resolvedParams.prompt,
          redirectUri: redirect,
          state: resolvedParams.state,
          nonce: resolvedParams.nonce,
          codeChallenge: auditCodeChallenge,
          codeChallengeMethod: resolvedCodeChallengeMethod,
          loginHint: resolvedParams.loginHint,
          freshLoginRequested: resolvedParams.freshLoginRequested,
        }),
        requestContext: requestContext ?? null,
      });
      return buildLoginRedirect();
    }
    if (strategy === "preauthorized") {
      return handlePreauthorizedAuthorize({
        params: resolvedParams,
        origin,
        tenantId: tenant.id,
        resourceId: resource.id,
        client,
        returnTo,
        requestContext,
      });
    }
    return handleProxyAuthorize({
      params: resolvedParams,
      origin,
      tenantId: tenant.id,
      resourceId: resource.id,
      client,
      requestContext,
    });
  }
  if (params.authStrategy && !isClientAuthStrategy(params.authStrategy)) {
    throw new DomainError("Requested auth strategy is not valid for this client", {
      status: 400,
      code: "invalid_request",
    });
  }

  const redirect = resolveRedirectUri(resolvedParams.redirectUri, client.redirectUris ?? []);

  ensureScopes(resolvedParams.scope.split(" ").filter(Boolean), client.allowedScopes);
  const traceId = randomUUID();
  void emitAuditEvent({
    tenantId: tenant.id,
    clientId: client.id,
    traceId,
    actorId: null,
    eventType: "AUTHORIZE_RECEIVED",
    severity: "INFO",
    message: "Authorization request received",
    details: buildAuthorizeReceivedDetails({
      responseType: resolvedParams.responseType,
      scope: resolvedParams.scope,
      prompt: resolvedParams.prompt,
      redirectUri: redirect,
      state: resolvedParams.state,
      nonce: resolvedParams.nonce,
      codeChallenge: auditCodeChallenge,
      codeChallengeMethod: resolvedCodeChallengeMethod,
      loginHint: resolvedParams.loginHint,
      freshLoginRequested: resolvedParams.freshLoginRequested,
    }),
    requestContext: requestContext ?? null,
  });
  const strategies = parseClientAuthStrategies(client.authStrategies);
  const session = resolvedParams.sessionToken ? await getSessionUser(tenant.id, resolvedParams.sessionToken) : null;
  const strategyAllowed = session
    ? strategies[fromPrismaLoginStrategy(session.loginStrategy)]?.enabled ?? false
    : false;
  const reauthTtlSeconds = client.reauthTtlSeconds ?? 0;
  const sessionTokenHash = resolvedParams.sessionToken ? hashOpaqueToken(resolvedParams.sessionToken) : null;
  const cookieValid = Boolean(
    reauthTtlSeconds > 0 &&
      sessionTokenHash &&
      resolvedParams.reauthCookie &&
      verifyReauthCookieValue(resolvedParams.reauthCookie, {
        tenantId: tenant.id,
        apiResourceId: resource.id,
        clientId: client.clientId,
        sessionHash: sessionTokenHash,
      }),
  );
  const freshLoginCookieValid = Boolean(
    resolvedParams.freshLoginRequested &&
      sessionTokenHash &&
      resolvedParams.freshLoginCookie &&
      verifyFreshLoginCookieValue(resolvedParams.freshLoginCookie, {
        tenantId: tenant.id,
        apiResourceId: resource.id,
        clientId: client.clientId,
        sessionHash: sessionTokenHash,
      }),
  );

  const reusedViaFreshLogin = Boolean(freshLoginCookieValid && session && strategyAllowed);
  const reusedViaReauthCookie = Boolean(cookieValid && session && strategyAllowed);
  const hasReusableLogin =
    resolvedParams.prompt === "login" ? reusedViaFreshLogin : reusedViaFreshLogin || reusedViaReauthCookie;

  if (resolvedParams.prompt === "login" && !reusedViaFreshLogin) {
    return buildLoginRedirect();
  }

  if (resolvedParams.prompt === "none" && !hasReusableLogin) {
    const redirectUrl = new URL(redirect);
    redirectUrl.searchParams.set("error", "login_required");
    if (resolvedParams.state) {
      redirectUrl.searchParams.set("state", resolvedParams.state);
    }
    return { type: "redirect" as const, redirectTo: redirectUrl.toString(), consumeFreshLoginCookie: reusedViaFreshLogin };
  }

  if (!hasReusableLogin) {
    return buildLoginRedirect();
  }

  if (!session) {
    throw new Error("Session is required when reusing login");
  }

  const code = await createAuthorizationCode({
    tenantId: tenant.id,
    clientId: client.id,
    apiResourceId: resource.id,
    userId: session.userId,
    loginStrategy: session.loginStrategy,
    subject: session.subject,
    emailVerifiedOverride: session.emailVerifiedOverride ?? undefined,
    redirectUri: redirect,
    scope: resolvedParams.scope,
    nonce: resolvedParams.nonce,
    state: resolvedParams.state,
    codeChallenge: resolvedCodeChallenge,
    codeChallengeMethod: resolvedCodeChallengeMethod,
    traceId,
  });

  const redirectUrl = new URL(redirect);
  redirectUrl.searchParams.set("code", code);
  if (resolvedParams.state) {
    redirectUrl.searchParams.set("state", resolvedParams.state);
  }

  return { type: "redirect" as const, redirectTo: redirectUrl.toString(), consumeFreshLoginCookie: reusedViaFreshLogin };
};

const handleProxyAuthorize = async (args: {
  params: AuthorizeParams;
  origin: string;
  tenantId: string;
  resourceId: string;
  client: Awaited<ReturnType<typeof getClientForTenant>>;
  requestContext?: RequestContext;
}): Promise<AuthorizeResult> => {
  const { params, origin, tenantId, resourceId, client, requestContext } = args;
  const codeChallenge = params.codeChallenge ?? "";
  const codeChallengeMethod = params.codeChallengeMethod ?? "S256";

  const redirect = resolveRedirectUri(params.redirectUri, client.redirectUris ?? []);
  ensureScopes(params.scope.split(" ").filter(Boolean), client.allowedScopes);

  const proxyConfig = client.proxyConfig;
  if (!proxyConfig) {
    throw new DomainError("Proxy client is missing provider configuration", { status: 500 });
  }

  const providerScopes = mapAppScopesToProvider(params.scope, proxyConfig);
  const callbackUrl = new URL(`/r/${resourceId}/oidc/proxy/callback`, origin).toString();
  const providerPrompt = proxyConfig.promptPassthroughEnabled ? params.prompt ?? null : null;
  const providerLoginHint = proxyConfig.loginHintPassthroughEnabled ? params.loginHint ?? null : null;

  let providerCodeVerifier: string | null = null;
  let providerCodeChallenge: string | null = null;
  if (proxyConfig.pkceSupported) {
    providerCodeVerifier = generateOpaqueToken(48);
    providerCodeChallenge = computeS256Challenge(providerCodeVerifier);
  }

  const transaction = await startProxyAuthTransaction({
    tenantId,
    apiResourceId: resourceId,
    clientId: client.id,
    redirectUri: redirect,
    appState: params.state,
    appNonce: params.nonce,
    appScope: params.scope,
    appCodeChallenge: codeChallenge,
    appCodeChallengeMethod: codeChallengeMethod,
    providerScope: providerScopes,
    providerCodeVerifier,
    providerPkceEnabled: Boolean(proxyConfig.pkceSupported),
    prompt: providerPrompt,
    loginHint: providerLoginHint,
  });

  await emitAuditEvent({
    tenantId,
    clientId: client.id,
    traceId: transaction.id,
    actorId: null,
    eventType: "AUTHORIZE_RECEIVED",
    severity: "INFO",
    message: "Proxy authorization request received",
    details: buildAuthorizeReceivedDetails({
      responseType: params.responseType,
      scope: params.scope,
      prompt: params.prompt,
      redirectUri: redirect,
      state: params.state,
      nonce: params.nonce,
      codeChallenge: codeChallenge,
      codeChallengeMethod: codeChallengeMethod,
      loginHint: params.loginHint,
      freshLoginRequested: params.freshLoginRequested,
    }),
    requestContext: requestContext ?? null,
  });

  try {
    let authorizeUrl: URL;
    try {
      authorizeUrl = new URL(proxyConfig.authorizationEndpoint);
    } catch (error) {
      if (error instanceof TypeError) {
        throw new DomainError(`authorizationEndpoint is not a valid URL: ${proxyConfig.authorizationEndpoint}`, {
          status: 500,
          code: "server_error",
        });
      }
      throw error;
    }
    authorizeUrl.searchParams.set("client_id", proxyConfig.upstreamClientId);
    authorizeUrl.searchParams.set("redirect_uri", callbackUrl);
    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("scope", providerScopes);
    authorizeUrl.searchParams.set("state", transaction.id);

    if (proxyConfig.oidcEnabled && params.nonce) {
      authorizeUrl.searchParams.set("nonce", params.nonce);
    }

    if (proxyConfig.pkceSupported && providerCodeChallenge) {
      authorizeUrl.searchParams.set("code_challenge", providerCodeChallenge);
      authorizeUrl.searchParams.set("code_challenge_method", "S256");
    }

    if (providerPrompt) {
      authorizeUrl.searchParams.set("prompt", providerPrompt);
    }

    if (providerLoginHint) {
      authorizeUrl.searchParams.set("login_hint", providerLoginHint);
    }

    const providerAuthorizationUrl = authorizeUrl.toString();
    const providerAuthorizationParams = searchParamsToRecord(authorizeUrl.searchParams);

    await emitAuditEvent({
      tenantId,
      clientId: client.id,
      traceId: transaction.id,
      actorId: null,
      eventType: "PROXY_REDIRECT_OUT",
      severity: "INFO",
      message: "Redirected to proxy provider",
      details: buildProxyRedirectOutDetails({
        providerType: proxyConfig.providerType,
        providerScope: providerScopes,
        providerPkceEnabled: proxyConfig.pkceSupported,
        providerAuthorizationUrl,
        providerAuthorizationParams,
        prompt: providerPrompt,
        loginHint: providerLoginHint,
        redirectUri: callbackUrl,
        state: transaction.id,
        nonce: params.nonce,
        codeChallenge: providerCodeChallenge,
        codeChallengeMethod: providerCodeChallenge ? "S256" : undefined,
        codeVerifier: providerCodeVerifier,
      }),
      requestContext: requestContext ?? null,
    });

    const cookies: CookieInstruction[] = [
      {
        name: PROXY_TRANSACTION_COOKIE,
        value: transaction.id,
        options: {
          path: buildProxyTransactionCookiePath(resourceId),
          httpOnly: true,
          sameSite: "lax",
          secure: origin.startsWith("https:"),
          maxAge: PROXY_TRANSACTION_TTL_SECONDS,
        },
      },
    ];

    return { type: "redirect", redirectTo: providerAuthorizationUrl, cookies };
  } catch (error) {
    await deleteProxyAuthTransaction(transaction.id);
    throw error;
  }
};

const handlePreauthorizedAuthorize = async (args: {
  params: AuthorizeParams;
  origin: string;
  tenantId: string;
  resourceId: string;
  client: Awaited<ReturnType<typeof getClientForTenant>>;
  returnTo: string;
  requestContext?: RequestContext;
}): Promise<AuthorizeResult> => {
  const { params, origin, tenantId, resourceId, client, returnTo, requestContext } = args;
  const codeChallenge = params.codeChallenge ?? "";
  const codeChallengeMethod = params.codeChallengeMethod ?? "S256";

  const redirect = resolveRedirectUri(params.redirectUri, client.redirectUris ?? []);
  ensureScopes(params.scope.split(" ").filter(Boolean), client.allowedScopes);

  if (!client.proxyConfig) {
    throw new DomainError("Preauthorized client is missing provider configuration", { status: 500 });
  }

  const transaction = await startPickerTransaction({
    tenantId,
    apiResourceId: resourceId,
    clientId: client.id,
    redirectUri: redirect,
    appState: params.state,
    appNonce: params.nonce,
    appScope: params.scope,
    appCodeChallenge: codeChallenge,
    appCodeChallengeMethod: codeChallengeMethod,
    loginHint: params.loginHint,
  });

  await emitAuditEvent({
    tenantId,
    clientId: client.id,
    traceId: transaction.id,
    actorId: null,
    eventType: "AUTHORIZE_RECEIVED",
    severity: "INFO",
    message: "Preauthorized authorization request received",
    details: buildAuthorizeReceivedDetails({
      responseType: params.responseType,
      scope: params.scope,
      prompt: params.prompt,
      redirectUri: redirect,
      state: params.state,
      nonce: params.nonce,
      codeChallenge: codeChallenge,
      codeChallengeMethod: codeChallengeMethod,
      loginHint: params.loginHint,
      freshLoginRequested: params.freshLoginRequested,
    }),
    requestContext: requestContext ?? null,
  });

  const cookies: CookieInstruction[] = [
    {
      name: PREAUTHORIZED_PICKER_COOKIE,
      value: transaction.id,
      options: {
        path: buildPreauthorizedPickerCookiePath(resourceId),
        httpOnly: true,
        sameSite: "lax",
        secure: origin.startsWith("https:"),
        maxAge: PREAUTHORIZED_PICKER_TTL_SECONDS,
      },
    },
  ];

  const returnToUrl = new URL(returnTo);
  returnToUrl.searchParams.set("auth_strategy", "preauthorized");
  const loginUrl = new URL(`/r/${resourceId}/oidc/login`, origin);
  loginUrl.searchParams.set("return_to", returnToUrl.toString());

  return {
    type: "redirect",
    redirectTo: loginUrl.toString(),
    cookies,
  };
};
