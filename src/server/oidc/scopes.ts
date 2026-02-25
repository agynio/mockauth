export const SUPPORTED_SCOPES = ["openid", "profile", "email"] as const;

export type SupportedScope = (typeof SUPPORTED_SCOPES)[number];

export const SCOPE_VALUE_PATTERN = /^[a-z0-9:_-]{1,64}$/;

export const normalizeScopes = (scopes: string[]): string[] => {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const scope of scopes) {
    const value = scope.trim().toLowerCase();
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    normalized.push(value);
  }
  return normalized;
};

export const isSupportedScope = (scope: string): scope is SupportedScope => {
  return SUPPORTED_SCOPES.includes(scope as SupportedScope);
};

export const isValidScopeValue = (scope: string): boolean => {
  return SCOPE_VALUE_PATTERN.test(scope);
};
