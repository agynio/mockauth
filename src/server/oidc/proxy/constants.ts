export const PROXY_TRANSACTION_COOKIE = "mockauth_proxy_tx";

export const buildProxyTransactionCookiePath = (apiResourceId: string) => `/r/${apiResourceId}/oidc`;
