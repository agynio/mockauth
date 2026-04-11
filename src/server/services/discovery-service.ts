import { issuerForResource } from "@/server/oidc/issuer";
import { SUPPORTED_SCOPES } from "@/server/oidc/scopes";
import { SUPPORTED_JWT_SIGNING_ALGS } from "@/server/oidc/signing-alg";

export const buildDiscoveryDocument = (origin: string, apiResourceId: string) => {
  const issuer = issuerForResource(origin, apiResourceId);
  return {
    issuer,
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/token`,
    userinfo_endpoint: `${issuer}/userinfo`,
    jwks_uri: `${issuer}/jwks.json`,
    end_session_endpoint: `${issuer}/end-session`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "password"],
    scopes_supported: SUPPORTED_SCOPES,
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post", "none"],
    id_token_signing_alg_values_supported: SUPPORTED_JWT_SIGNING_ALGS,
  };
};
