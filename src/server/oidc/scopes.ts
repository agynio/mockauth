export const SUPPORTED_SCOPES = ["openid", "profile", "email"] as const;

export type SupportedScope = (typeof SUPPORTED_SCOPES)[number];

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
