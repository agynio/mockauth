export const MOCK_REAUTH_COOKIE = "mockauth_reauth_ok" as const;
export const REAUTH_COOKIE_TTL_SECONDS = 60;

export const buildReauthCookiePath = (apiResourceId: string) => `/r/${apiResourceId}/oidc`;
