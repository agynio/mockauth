import { prisma } from "@/server/db/client";
import { DomainError } from "@/server/errors";
import { resolveRedirectUri } from "@/server/oidc/redirect-uri";
import { createAuthorizationCode } from "@/server/services/authorization-code-service";
import { getSessionUser } from "@/server/services/mock-session-service";
import { getClientForTenant } from "@/server/services/client-service";
import { getActiveTenantBySlug } from "@/server/services/tenant-service";

type AuthorizeParams = {
  tenantSlug: string;
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

  const tenant = await getActiveTenantBySlug(params.tenantSlug);
  const client = await getClientForTenant(tenant.id, params.clientId);
  const redirect = resolveRedirectUri(params.redirectUri, client.redirectUris ?? []);

  ensureScopes(params.scope.split(" ").filter(Boolean), client.allowedScopes);

  const session = await getSessionUser(tenant.id, params.sessionToken);
  const shouldLogin = params.prompt === "login" || !session;

  if (shouldLogin) {
    return {
      type: "login" as const,
      redirectTo: `/t/${tenant.slug}/oidc/login?return_to=${encodeURIComponent(returnTo)}`,
    };
  }

  const code = await createAuthorizationCode({
    tenantId: tenant.id,
    clientId: client.id,
    userId: session.userId,
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
