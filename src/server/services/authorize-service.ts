import { DomainError } from "@/server/errors";
import { resolveRedirectUri } from "@/server/oidc/redirect-uri";
import { createAuthorizationCode } from "@/server/services/authorization-code-service";
import { getSessionUser } from "@/server/services/mock-session-service";
import { getClientForTenant } from "@/server/services/client-service";
import { getApiResourceWithTenant } from "@/server/services/api-resource-service";
import { fromPrismaLoginStrategy, parseClientAuthStrategies } from "@/server/oidc/auth-strategy";
import { isSupportedScope, normalizeScopes } from "@/server/oidc/scopes";
import { verifyFreshLoginCookieValue, verifyReauthCookieValue } from "@/server/oidc/reauth-cookie";
import { hashOpaqueToken } from "@/server/crypto/opaque-token";

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
  sessionToken?: string;
  reauthCookie?: string;
  freshLoginCookie?: string;
  freshLoginRequested?: boolean;
};

type AuthorizeResult =
  | { type: "login"; redirectTo: string; consumeFreshLoginCookie?: boolean }
  | { type: "redirect"; redirectTo: string; consumeFreshLoginCookie?: boolean };

const ensureScopes = (requestedScopes: string[], allowedScopes: string[]) => {
  const requested = normalizeScopes(requestedScopes);
  const allowed = new Set(normalizeScopes(allowedScopes));

  if (!requested.includes("openid")) {
    throw new DomainError("scope must include openid", { status: 400, code: "invalid_scope" });
  }

  const unsupported = requested.filter((scope) => !isSupportedScope(scope));
  if (unsupported.length > 0) {
    throw new DomainError(`Unsupported scopes: ${unsupported.join(", ")}`, { status: 400, code: "invalid_scope" });
  }

  const notAllowed = requested.filter((scope) => !allowed.has(scope));
  if (notAllowed.length > 0) {
    throw new DomainError(`Client does not allow scopes: ${notAllowed.join(", ")}`, {
      status: 400,
      code: "invalid_scope",
    });
  }
};

export const handleAuthorize = async (params: AuthorizeParams, origin: string, returnTo: string): Promise<AuthorizeResult> => {
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
  const redirect = resolveRedirectUri(params.redirectUri, client.redirectUris ?? []);

  ensureScopes(params.scope.split(" ").filter(Boolean), client.allowedScopes);
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
  const hasReusableLogin = reusedViaFreshLogin || reusedViaReauthCookie;

  const buildLoginRedirect = (): AuthorizeResult => ({
    type: "login",
    redirectTo: `/r/${resource.id}/oidc/login?return_to=${encodeURIComponent(new URL(returnTo).toString())}`,
  });

  if (params.prompt === "login") {
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
  });

  const redirectUrl = new URL(redirect);
  redirectUrl.searchParams.set("code", code);
  if (params.state) {
    redirectUrl.searchParams.set("state", params.state);
  }

  return { type: "redirect" as const, redirectTo: redirectUrl.toString(), consumeFreshLoginCookie: reusedViaFreshLogin };
};
