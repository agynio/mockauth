import { randomUUID } from "node:crypto";

import { DomainError } from "@/server/errors";
import { resolveRedirectUri } from "@/server/oidc/redirect-uri";
import { createAuthorizationCode } from "@/server/services/authorization-code-service";
import { getSessionUser } from "@/server/services/mock-session-service";
import { getClientForTenant } from "@/server/services/client-service";
import { getApiResourceWithTenant } from "@/server/services/api-resource-service";
import { fromPrismaLoginStrategy, parseClientAuthStrategies } from "@/server/oidc/auth-strategy";
import { normalizeScopes } from "@/server/oidc/scopes";
import { verifyFreshLoginCookieValue, verifyReauthCookieValue } from "@/server/oidc/reauth-cookie";
import { hashOpaqueToken, generateOpaqueToken } from "@/server/crypto/opaque-token";
import { computeS256Challenge } from "@/server/crypto/pkce";
import { emitAuditEvent } from "@/server/services/audit-service";
import { buildAuthorizeReceivedDetails, buildProxyRedirectOutDetails } from "@/server/services/audit-event";
import { auditRedactionState } from "@/server/services/audit-redaction";
import {
  PROXY_TRANSACTION_TTL_SECONDS,
  startProxyAuthTransaction,
  deleteProxyAuthTransaction,
} from "@/server/services/proxy-service";
import { PROXY_TRANSACTION_COOKIE, buildProxyTransactionCookiePath } from "@/server/oidc/proxy/constants";
import type { RequestContext } from "@/server/utils/request-context";

type LoadedClient = Awaited<ReturnType<typeof getClientForTenant>>;
type ProxyProviderConfigRecord = NonNullable<LoadedClient["proxyConfig"]>;

const includeSensitive = !auditRedactionState.redactionEnabled;

type AuthorizeParams = {
  apiResourceId: string;
  clientId: string;
  redirectUri: string;
  responseType: string;
  scope: string;
  state?: string;
  nonce?: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  prompt?: string;
  loginHint?: string;
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

export const handleAuthorize = async (
  params: AuthorizeParams,
  origin: string,
  returnTo: string,
  requestContext?: RequestContext,
): Promise<AuthorizeResult> => {
  if (params.responseType !== "code") {
    throw new DomainError("Only response_type=code is supported", { status: 400, code: "unsupported_response_type" });
  }

  if (params.codeChallengeMethod !== "S256") {
    throw new DomainError("Only PKCE S256 is supported", { status: 400, code: "invalid_request" });
  }

  const { tenant, resource } = await getApiResourceWithTenant(params.apiResourceId);
  const client = await getClientForTenant(tenant.id, params.clientId);
  const clientResourceId = client.apiResourceId ?? tenant.defaultApiResourceId;
  if (clientResourceId !== resource.id) {
    throw new DomainError("Client is not configured for this issuer", { status: 400, code: "invalid_client" });
  }

  if (client.oauthClientMode === "proxy") {
    return handleProxyAuthorize({ params, origin, tenantId: tenant.id, resourceId: resource.id, client, requestContext });
  }
  const redirect = resolveRedirectUri(params.redirectUri, client.redirectUris ?? []);

  ensureScopes(params.scope.split(" ").filter(Boolean), client.allowedScopes);
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
      responseType: params.responseType,
      scope: params.scope,
      prompt: params.prompt,
      redirectUri: redirect,
      state: params.state,
      nonce: params.nonce,
      codeChallenge: params.codeChallenge,
      codeChallengeMethod: params.codeChallengeMethod,
      loginHint: params.loginHint,
      freshLoginRequested: params.freshLoginRequested,
      includeSensitive,
    }),
    requestContext: requestContext ?? null,
  });
  const strategies = parseClientAuthStrategies(client.authStrategies);
  const session = params.sessionToken ? await getSessionUser(tenant.id, params.sessionToken) : null;
  const strategyAllowed = session
    ? strategies[fromPrismaLoginStrategy(session.loginStrategy)]?.enabled ?? false
    : false;
  const reauthTtlSeconds = client.reauthTtlSeconds ?? 0;
  const sessionTokenHash = params.sessionToken ? hashOpaqueToken(params.sessionToken) : null;
  const cookieValid = Boolean(
    reauthTtlSeconds > 0 &&
      sessionTokenHash &&
      params.reauthCookie &&
      verifyReauthCookieValue(params.reauthCookie, {
        tenantId: tenant.id,
        apiResourceId: resource.id,
        clientId: client.clientId,
        sessionHash: sessionTokenHash,
      }),
  );
  const freshLoginCookieValid = Boolean(
    params.freshLoginRequested &&
      sessionTokenHash &&
      params.freshLoginCookie &&
      verifyFreshLoginCookieValue(params.freshLoginCookie, {
        tenantId: tenant.id,
        apiResourceId: resource.id,
        clientId: client.clientId,
        sessionHash: sessionTokenHash,
      }),
  );

  const reusedViaFreshLogin = Boolean(freshLoginCookieValid && session && strategyAllowed);
  const reusedViaReauthCookie = Boolean(cookieValid && session && strategyAllowed);
  const hasReusableLogin = params.prompt === "login" ? reusedViaFreshLogin : reusedViaFreshLogin || reusedViaReauthCookie;

  const buildLoginRedirect = (): AuthorizeResult => ({
    type: "login",
    redirectTo: `/r/${resource.id}/oidc/login?return_to=${encodeURIComponent(new URL(returnTo).toString())}`,
  });

  if (params.prompt === "login" && !reusedViaFreshLogin) {
    return buildLoginRedirect();
  }

  if (params.prompt === "none" && !hasReusableLogin) {
    const redirectUrl = new URL(redirect);
    redirectUrl.searchParams.set("error", "login_required");
    if (params.state) {
      redirectUrl.searchParams.set("state", params.state);
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
    scope: params.scope,
    nonce: params.nonce,
    state: params.state,
    codeChallenge: params.codeChallenge,
    codeChallengeMethod: params.codeChallengeMethod,
    traceId,
  });

  const redirectUrl = new URL(redirect);
  redirectUrl.searchParams.set("code", code);
  if (params.state) {
    redirectUrl.searchParams.set("state", params.state);
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
    appCodeChallenge: params.codeChallenge,
    appCodeChallengeMethod: params.codeChallengeMethod,
    providerScope: providerScopes,
    providerCodeVerifier,
    providerPkceEnabled: Boolean(proxyConfig.pkceSupported),
    prompt: providerPrompt,
    loginHint: providerLoginHint,
  });

  void emitAuditEvent({
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
      codeChallenge: params.codeChallenge,
      codeChallengeMethod: params.codeChallengeMethod,
      loginHint: params.loginHint,
      freshLoginRequested: params.freshLoginRequested,
      includeSensitive,
    }),
    requestContext: requestContext ?? null,
  });

  try {
    const authorizeUrl = new URL(proxyConfig.authorizationEndpoint);
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

    void emitAuditEvent({
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
        prompt: providerPrompt,
        loginHint: providerLoginHint,
        redirectUri: callbackUrl,
        state: transaction.id,
        nonce: params.nonce,
        codeChallenge: providerCodeChallenge,
        codeChallengeMethod: providerCodeChallenge ? "S256" : undefined,
        codeVerifier: providerCodeVerifier,
        includeSensitive,
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

    return { type: "redirect", redirectTo: authorizeUrl.toString(), cookies };
  } catch (error) {
    await deleteProxyAuthTransaction(transaction.id);
    throw error;
  }
};

const mapAppScopesToProvider = (scopeString: string, config: ProxyProviderConfigRecord): string => {
  const requestedScopes = scopeString.split(" ").map((scope) => scope.trim()).filter(Boolean);
  const mapping = parseScopeMapping(config.scopeMapping);
  const providerScopes = new Set<string>();

  for (const scope of requestedScopes) {
    const value = mapping.get(scope);
    if (!value || value.length === 0) {
      providerScopes.add(scope);
      continue;
    }

    for (const mapped of value) {
      if (mapped) {
        providerScopes.add(mapped);
      }
    }
  }

  if (providerScopes.size === 0) {
    for (const fallback of config.defaultScopes ?? []) {
      if (fallback) {
        providerScopes.add(fallback);
      }
    }
  }

  if (providerScopes.size === 0) {
    throw new DomainError("Proxy provider scopes configuration is empty", { status: 500 });
  }

  return Array.from(providerScopes).join(" ");
};

const parseScopeMapping = (value: unknown): Map<string, string[]> => {
  if (!value || typeof value !== "object") {
    return new Map();
  }

  const entries: Array<[string, string[]]> = [];
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof key !== "string") {
      continue;
    }
    if (typeof raw === "string") {
      const scopes = raw
        .split(" ")
        .map((scope) => scope.trim())
        .filter(Boolean);
      entries.push([key, scopes]);
      continue;
    }
    if (Array.isArray(raw)) {
      const scopes = raw
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter((item) => item.length > 0);
      entries.push([key, scopes]);
    }
  }

  return new Map(entries);
};
