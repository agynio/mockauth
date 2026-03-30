import type { ProxyProviderConfig } from "@/generated/prisma/client";
import { DomainError } from "@/server/errors";

/**
 * Normalize stored scope mapping JSON into a map of app scopes
 * to provider scopes, trimming and filtering invalid values.
 */
export const parseScopeMapping = (value: unknown): Map<string, string[]> => {
  if (!value || typeof value !== "object") {
    return new Map();
  }

  const entries: Array<[string, string[]]> = [];
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === "string") {
      const scopes = raw
        .split(" ")
        .map((scope) => scope.trim())
        .filter(Boolean);
      entries.push([key, scopes]);
      continue;
    }
    if (Array.isArray(raw)) {
      const scopes = raw
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter((item) => item.length > 0);
      entries.push([key, scopes]);
    }
  }

  return new Map(entries);
};

export const mapAppScopesToProvider = (scopeString: string, config: ProxyProviderConfig): string => {
  const requestedScopes = scopeString.split(" ").map((scope) => scope.trim()).filter(Boolean);
  const mapping = parseScopeMapping(config.scopeMapping);
  const providerScopes = new Set<string>();

  for (const scope of requestedScopes) {
    const value = mapping.get(scope);
    if (!value || value.length === 0) {
      providerScopes.add(scope);
      continue;
    }

    for (const mapped of value) {
      if (mapped) {
        providerScopes.add(mapped);
      }
    }
  }

  if (providerScopes.size === 0) {
    for (const fallback of config.defaultScopes ?? []) {
      if (fallback) {
        providerScopes.add(fallback);
      }
    }
  }

  if (providerScopes.size === 0) {
    throw new DomainError("Proxy provider scopes configuration is empty", { status: 500 });
  }

  return Array.from(providerScopes).join(" ");
};
