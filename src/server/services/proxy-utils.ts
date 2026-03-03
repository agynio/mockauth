type TokenResponseOptions = {
  passthrough: boolean;
  fallbackScope?: string;
};

const STANDARD_TOKEN_FIELDS = new Set([
  "access_token",
  "token_type",
  "expires_in",
  "refresh_token",
  "id_token",
  "scope",
]);

export const sanitizeProviderError = (value: string | undefined) => {
  if (!value) {
    return "access_denied";
  }

  const normalized = value.trim();
  if (!/^[a-z0-9_\.:-]{1,64}$/i.test(normalized)) {
    return "server_error";
  }
  return normalized;
};

export const sanitizeProviderErrorDescription = (value: string | undefined) => {
  if (!value) {
    return undefined;
  }

  return value.trim().slice(0, 256);
};

export const buildProxyTokenResponse = (
  providerResponse: Record<string, unknown>,
  options: TokenResponseOptions,
): Record<string, unknown> => {
  if (options.passthrough) {
    const clone: Record<string, unknown> = { ...providerResponse };
    if (clone.scope === undefined && options.fallbackScope) {
      clone.scope = options.fallbackScope;
    }
    return clone;
  }

  const result: Record<string, unknown> = {};
  for (const field of STANDARD_TOKEN_FIELDS) {
    if (providerResponse[field] !== undefined) {
      result[field] = providerResponse[field];
    }
  }

  if (result.scope === undefined && options.fallbackScope) {
    result.scope = options.fallbackScope;
  }

  return result;
};
