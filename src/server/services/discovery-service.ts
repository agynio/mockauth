import { issuerForResource } from "@/server/oidc/issuer";

const SUPPORTED_SCOPES = ["openid", "profile", "email"];

export const buildDiscoveryDocument = (origin: string, tenantId: string, apiResourceId: string) => {
  const issuer = issuerForResource(origin, tenantId, apiResourceId);
  return {
    issuer,
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/token`,
    userinfo_endpoint: `${issuer}/userinfo`,
    jwks_uri: `${issuer}/jwks.json`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    scopes_supported: SUPPORTED_SCOPES,
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post", "none"],
    id_token_signing_alg_values_supported: ["RS256"],
  };
};
