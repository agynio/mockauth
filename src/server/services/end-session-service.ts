import { DomainError } from "@/server/errors";
import { issuerForResource } from "@/server/oidc/issuer";
import { resolveRedirectUri } from "@/server/oidc/redirect-uri";
import { getClientForTenant } from "@/server/services/client-service";
import { clearSession } from "@/server/services/mock-session-service";
import { getApiResourceWithTenant } from "@/server/services/api-resource-service";

type EndSessionParams = {
  apiResourceId: string;
  idTokenHint?: string;
  postLogoutRedirectUri?: string;
  clientId?: string;
  state?: string;
  sessionToken?: string;
};

type EndSessionResult =
  | { type: "redirect"; redirectTo: string; clearSessionCookie: boolean }
  | { type: "html"; html: string; clearSessionCookie: boolean };

const LOGGED_OUT_HTML = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Logged out</title>
  </head>
  <body>
    <p>You have been logged out.</p>
  </body>
</html>`;

const parseJwtPayload = (token: string) => {
  const [header, payload] = token.split(".");
  if (!header || !payload) {
    throw new DomainError("id_token_hint is not a valid JWT", { status: 400, code: "invalid_request" });
  }

  try {
    const decoded = Buffer.from(payload, "base64url").toString("utf8");
    const parsed = JSON.parse(decoded) as unknown;
    if (!parsed || typeof parsed !== "object") {
      throw new DomainError("id_token_hint payload is invalid", { status: 400, code: "invalid_request" });
    }
    return parsed as { iss?: unknown; aud?: unknown };
  } catch (error) {
    if (error instanceof DomainError) {
      throw error;
    }
    throw new DomainError("id_token_hint payload is invalid", { status: 400, code: "invalid_request" });
  }
};

const parseAudiences = (audience: unknown) => {
  if (typeof audience === "string") {
    return [audience];
  }

  if (Array.isArray(audience) && audience.every((entry) => typeof entry === "string")) {
    return audience;
  }

  throw new DomainError("id_token_hint must include aud", { status: 400, code: "invalid_request" });
};

export const handleEndSession = async (params: EndSessionParams, origin: string): Promise<EndSessionResult> => {
  const { tenant } = await getApiResourceWithTenant(params.apiResourceId);
  const issuer = issuerForResource(origin, params.apiResourceId);

  let audiences: string[] | null = null;
  if (params.idTokenHint) {
    const payload = parseJwtPayload(params.idTokenHint);
    if (typeof payload.iss !== "string") {
      throw new DomainError("id_token_hint must include iss", { status: 400, code: "invalid_request" });
    }
    if (payload.iss !== issuer) {
      throw new DomainError("id_token_hint issuer mismatch", { status: 400, code: "invalid_request" });
    }

    audiences = parseAudiences(payload.aud);
    if (params.clientId && !audiences.includes(params.clientId)) {
      throw new DomainError("client_id does not match id_token_hint", { status: 400, code: "invalid_request" });
    }
  }

  const resolvedClientId = params.clientId ?? audiences?.[0];
  const client = resolvedClientId ? await getClientForTenant(tenant.id, resolvedClientId) : null;
  const redirectUri =
    params.postLogoutRedirectUri && client
      ? resolveRedirectUri(params.postLogoutRedirectUri, client.redirectUris ?? [])
      : null;

  const clearSessionCookie = Boolean(params.sessionToken);
  if (params.sessionToken) {
    await clearSession(tenant.id, params.sessionToken);
  }

  if (redirectUri) {
    const redirectUrl = new URL(redirectUri);
    if (params.state) {
      redirectUrl.searchParams.set("state", params.state);
    }
    return { type: "redirect", redirectTo: redirectUrl.toString(), clearSessionCookie };
  }

  return { type: "html", html: LOGGED_OUT_HTML, clearSessionCookie };
};
