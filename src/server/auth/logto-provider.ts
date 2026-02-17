import type { OAuthConfig, OAuthUserConfig } from "next-auth/providers/oauth";

export interface LogtoProfile {
  sub: string;
  name?: string;
  username?: string;
  email?: string;
}

export interface LogtoProviderOptions<P extends LogtoProfile> extends OAuthUserConfig<P> {
  issuer: string;
  scope?: string;
}

export default function LogtoProvider<P extends LogtoProfile>(
  options: LogtoProviderOptions<P>,
): OAuthConfig<P> {
  const { issuer, scope, client, ...rest } = options;
  const issuerUrl = issuer.replace(/\/$/, "");
  return {
    id: "logto",
    name: "Logto",
    type: "oauth",
    wellKnown: `${issuerUrl}/.well-known/openid-configuration`,
    authorization: {
      params: {
        scope: scope ?? "openid profile email",
      },
    },
    idToken: true,
    checks: ["pkce", "state"],
    client: {
      token_endpoint_auth_method: "client_secret_basic",
      id_token_signed_response_alg: "ES384",
      ...client,
    },
    profile(profile: LogtoProfile) {
      return {
        id: profile.sub,
        name: profile.name ?? profile.username ?? undefined,
        email: profile.email ?? undefined,
      } satisfies { id: string; name?: string; email?: string };
    },
    ...rest,
  };
}
