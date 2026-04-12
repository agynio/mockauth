export const tokenAuthMethodOptions = ["client_secret_basic", "client_secret_post", "none"] as const;
export type TokenAuthMethodOption = (typeof tokenAuthMethodOptions)[number];

export const grantTypeOptions = ["authorization_code", "password", "refresh_token"] as const;
export type GrantTypeOption = (typeof grantTypeOptions)[number];

export const TOKEN_AUTH_METHOD_LABELS: Record<TokenAuthMethodOption, { title: string; description: string }> = {
  client_secret_basic: {
    title: "Client secret (basic)",
    description: "Authenticate with HTTP basic auth at the token endpoint.",
  },
  client_secret_post: {
    title: "Client secret (post)",
    description: "Send client_id/client_secret in the token request body.",
  },
  none: {
    title: "None",
    description: "Public client without a secret.",
  },
};

export const GRANT_TYPE_LABELS: Record<GrantTypeOption, { title: string; description: string }> = {
  authorization_code: {
    title: "Authorization code",
    description: "Standard redirect-based flow.",
  },
  password: {
    title: "Resource owner password",
    description: "Exchange username/password directly.",
  },
  refresh_token: {
    title: "Refresh token",
    description: "Allow refresh_token grants for regular clients with offline_access.",
  },
};
