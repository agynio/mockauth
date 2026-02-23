import { DomainError } from "@/server/errors";
import { resolveRedirectUri } from "@/server/oidc/redirect-uri";
import { createAuthorizationCode } from "@/server/services/authorization-code-service";
import { getSessionUser } from "@/server/services/mock-session-service";
import { getClientForTenant } from "@/server/services/client-service";
import { getApiResourceWithTenant } from "@/server/services/api-resource-service";
import { fromPrismaLoginStrategy, parseClientAuthStrategies } from "@/server/oidc/auth-strategy";

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
  reauthenticated?: boolean;
};

const ensureScopes = (requested: string[], allowed: string[]) => {
  if (!requested.includes("openid")) {
    throw new DomainError("scope must include openid", { status: 400, code: "invalid_scope" });
  }

  const invalid = requested.filter((scope) => !allowed.includes(scope));
  if (invalid.length > 0) {
    throw new DomainError(`Unsupported scopes: ${invalid.join(", ")}`, { status: 400, code: "invalid_scope" });
  }
};

export const handleAuthorize = async (params: AuthorizeParams, origin: string, returnTo: string) => {
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

  if (params.prompt === "none") {
    const redirectUrl = new URL(redirect);
    redirectUrl.searchParams.set("error", "login_required");
    if (params.state) {
      redirectUrl.searchParams.set("state", params.state);
    }
    return { type: "redirect" as const, redirectTo: redirectUrl.toString() };
  }

  const strategies = parseClientAuthStrategies(client.authStrategies);
  const session = params.reauthenticated ? await getSessionUser(tenant.id, params.sessionToken) : null;
  const strategyAllowed = session
    ? strategies[fromPrismaLoginStrategy(session.loginStrategy)]?.enabled ?? false
    : false;
  const mustPrompt = params.prompt === "login" && !params.reauthenticated;
  const shouldLogin = !params.reauthenticated || mustPrompt || !session || !strategyAllowed;

  if (shouldLogin) {
    const loginReturnUrl = new URL(returnTo);
    return {
      type: "login" as const,
      redirectTo: `/r/${resource.id}/oidc/login?return_to=${encodeURIComponent(loginReturnUrl.toString())}`,
    };
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

  return { type: "redirect" as const, redirectTo: redirectUrl.toString() };
};
