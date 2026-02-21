import { DomainError } from "@/server/errors";
import { resolveRedirectUri } from "@/server/oidc/redirect-uri";
import { createAuthorizationCode } from "@/server/services/authorization-code-service";
import { getSessionUser } from "@/server/services/mock-session-service";
import { getClientForTenant } from "@/server/services/client-service";
import { getActiveTenantById } from "@/server/services/tenant-service";
import { getApiResourceForTenant } from "@/server/services/api-resource-service";
import { fromPrismaLoginStrategy, parseClientAuthStrategies } from "@/server/oidc/auth-strategy";

type AuthorizeParams = {
  tenantId: string;
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

  const tenant = await getActiveTenantById(params.tenantId);
  const resource = await getApiResourceForTenant(tenant.id, params.apiResourceId);
  const client = await getClientForTenant(tenant.id, params.clientId);
  const clientResourceId = client.apiResourceId ?? tenant.defaultApiResourceId;
  if (clientResourceId !== resource.id) {
    throw new DomainError("Client is not configured for this issuer", { status: 400, code: "invalid_client" });
  }
  const redirect = resolveRedirectUri(params.redirectUri, client.redirectUris ?? []);

  ensureScopes(params.scope.split(" ").filter(Boolean), client.allowedScopes);

  const strategies = parseClientAuthStrategies(client.authStrategies);
  const session = await getSessionUser(tenant.id, params.sessionToken);
  const strategyAllowed = session
    ? strategies[fromPrismaLoginStrategy(session.loginStrategy)]?.enabled ?? false
    : true;
  const shouldLogin = params.prompt === "login" || !session || !strategyAllowed;

  if (shouldLogin) {
    return {
      type: "login" as const,
      redirectTo: `/t/${tenant.id}/r/${resource.id}/oidc/login?return_to=${encodeURIComponent(returnTo)}`,
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
