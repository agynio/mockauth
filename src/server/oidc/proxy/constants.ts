export const PROXY_TRANSACTION_COOKIE = "mockauth_proxy_tx";

export const buildProxyTransactionCookiePath = (apiResourceId: string) => `/r/${apiResourceId}/oidc`;

export const buildProxyCallbackUrl = (origin: string, apiResourceId: string) =>
  new URL(`/r/${apiResourceId}/oidc/proxy/callback`, origin).toString();
