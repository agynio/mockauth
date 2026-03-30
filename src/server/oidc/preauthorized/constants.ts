export const PREAUTHORIZED_PICKER_COOKIE = "mockauth_preauth_picker";
export const PREAUTHORIZED_ADMIN_TRANSACTION_COOKIE = "mockauth_preauth_admin_tx";

export const buildPreauthorizedPickerCookiePath = (apiResourceId: string) => `/r/${apiResourceId}/oidc`;

export const buildPreauthorizedAdminTransactionCookiePath = (clientId: string) => `/admin/clients/${clientId}`;

export const buildPreauthorizedAdminCallbackUrl = (origin: string, clientId: string) =>
  new URL(`/admin/clients/${clientId}/preauthorized/callback`, origin).toString();
