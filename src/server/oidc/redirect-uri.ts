import { RedirectUriType } from "@/generated/prisma/client";
import { DomainError } from "@/server/errors";
import { allowAnyRedirects } from "@/server/oidc/redirect-policy";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const HOST_WILDCARD_REGEX = /^https:\/\/\*\.([a-zA-Z0-9.-]+)(?<path>\/[a-zA-Z0-9\-._~!$&'()*+,;=:@\/]*)?$/;
const ANY_REDIRECT_VALUE = "*";
const PATH_WILDCARD_SUFFIX = "/*";

const parseUrl = (value: string): URL => {
  try {
    return new URL(value);
  } catch (error) {
    if (error instanceof TypeError) {
      throw new DomainError(`redirect_uri is not a valid URL: ${value}`, {
        status: 400,
        code: "invalid_redirect_uri",
      });
    }
    throw error;
  }
};

const ensureSchemeAllowed = (url: URL) => {
  const host = url.hostname.toLowerCase();
  if (url.protocol === "https:") {
    return;
  }

  if (url.protocol === "http:" && LOCAL_HOSTS.has(host)) {
    return;
  }

  throw new DomainError("redirect_uri must use https", { status: 400, code: "invalid_redirect_uri" });
};

const ensureNoFragment = (url: URL) => {
  if (url.hash && url.hash !== "") {
    throw new DomainError("redirect_uri must not include fragment", { status: 400, code: "invalid_redirect_uri" });
  }
};

const normalizeUrl = (url: URL) => {
  ensureNoFragment(url);
  url.hostname = url.hostname.toLowerCase();
  if (!url.pathname) {
    url.pathname = "/";
  }
  return url;
};

const normalizeHostWildcard = (value: string) => {
  if (value.endsWith(PATH_WILDCARD_SUFFIX)) {
    throw new DomainError("Host wildcards do not support path wildcards", { code: "invalid_redirect_uri" });
  }
  const normalizedScheme = value.replace(/^https:\/\//i, "https://");
  const match = HOST_WILDCARD_REGEX.exec(normalizedScheme);
  if (!match || !match[1]) {
    throw new DomainError("Invalid host wildcard redirect", { code: "invalid_redirect_uri" });
  }

  const path = match.groups?.path ?? "/";
  return `https://*.${match[1].toLowerCase()}${path}`;
};

export const classifyRedirect = (value: string): { type: RedirectUriType; normalized: string } => {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new DomainError("redirect_uri is required", { code: "invalid_redirect_uri" });
  }

  if (trimmed === ANY_REDIRECT_VALUE) {
    return { type: RedirectUriType.ANY, normalized: ANY_REDIRECT_VALUE };
  }

  const schemeNormalized = trimmed.replace(/^https:\/\//i, "https://");

  if (schemeNormalized.startsWith("https://*.")) {
    if (trimmed.includes("?")) {
      throw new DomainError("Host wildcards cannot include query parameters", { code: "invalid_redirect_uri" });
    }
    if (trimmed.includes("#")) {
      throw new DomainError("Host wildcards cannot include fragment", { code: "invalid_redirect_uri" });
    }
    return { type: RedirectUriType.HOST_WILDCARD, normalized: normalizeHostWildcard(trimmed) };
  }

  if (trimmed.endsWith(PATH_WILDCARD_SUFFIX)) {
    const withoutSuffix = trimmed.slice(0, -1);
    const url = normalizeUrl(parseUrl(withoutSuffix));
    ensureSchemeAllowed(url);
    if (url.search) {
      throw new DomainError("Path wildcards cannot include query parameters", { code: "invalid_redirect_uri" });
    }
    return { type: RedirectUriType.PATH_SUFFIX, normalized: `${url.origin}${url.pathname}*` };
  }

  const url = normalizeUrl(parseUrl(trimmed));
  ensureSchemeAllowed(url);
  return { type: RedirectUriType.EXACT, normalized: `${url.origin}${url.pathname}${url.search}` };
};

type RedirectRecord = {
  uri: string;
  type: RedirectUriType;
  enabled: boolean;
};

const matchHostWildcard = (record: RedirectRecord, candidate: URL): boolean => {
  const match = HOST_WILDCARD_REGEX.exec(record.uri);
  if (!match || !match[1]) {
    return false;
  }

  if (candidate.protocol !== "https:") {
    return false;
  }

  const baseLabels = match[1].toLowerCase().split(".");
  const candidateLabels = candidate.hostname.toLowerCase().split(".");
  if (candidateLabels.length !== baseLabels.length + 1) {
    return false;
  }

  const [, ...rest] = candidateLabels;
  if (!rest.every((label, idx) => label === baseLabels[idx])) {
    return false;
  }

  const requiredPath = match.groups?.path ?? "/";
  return candidate.pathname === requiredPath;
};

const matchPathSuffix = (record: RedirectRecord, candidate: URL): boolean => {
  const normalized = normalizeUrl(new URL(record.uri.slice(0, -1))); // remove the '*'
  if (candidate.origin !== normalized.origin) {
    return false;
  }
  return candidate.pathname.startsWith(normalized.pathname);
};

const matchExact = (record: RedirectRecord, candidate: URL): boolean => {
  const normalized = `${candidate.origin}${candidate.pathname}${candidate.search}`;
  return normalized === record.uri;
};

export const resolveRedirectUri = (candidate: string, redirects: RedirectRecord[]): string => {
  const url = normalizeUrl(parseUrl(candidate));
  ensureSchemeAllowed(url);

  const match = redirects.some((redirect) => {
    if (!redirect.enabled) {
      return false;
    }

    if (redirect.type === RedirectUriType.EXACT) {
      return matchExact(redirect, url);
    }

    if (redirect.type === RedirectUriType.HOST_WILDCARD) {
      return matchHostWildcard(redirect, url);
    }

    if (redirect.type === RedirectUriType.PATH_SUFFIX) {
      return matchPathSuffix(redirect, url);
    }

    if (redirect.type === RedirectUriType.ANY) {
      return allowAnyRedirects();
    }

    return false;
  });

  if (!match) {
    throw new DomainError("redirect_uri mismatch", { status: 400, code: "invalid_redirect_uri" });
  }

  return `${url.origin}${url.pathname}${url.search}`;
};
