export const PREAUTHORIZED_PICKER_COOKIE = "mockauth_preauth_picker";
export const PREAUTHORIZED_ADMIN_TRANSACTION_COOKIE = "mockauth_preauth_admin_tx";

export const buildPreauthorizedPickerCookiePath = (apiResourceId: string) => `/r/${apiResourceId}/oidc`;

export const buildPreauthorizedAdminTransactionCookiePath = (apiResourceId: string) => `/r/${apiResourceId}/oidc`;

export const buildPreauthorizedAdminCallbackUrl = (origin: string, apiResourceId: string) =>
  new URL(`/r/${apiResourceId}/oidc/preauthorized/callback`, origin).toString();
