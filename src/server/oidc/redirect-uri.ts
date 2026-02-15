import { RedirectUriType } from "@/generated/prisma";
import { DomainError } from "@/server/errors";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);
const HOST_WILDCARD_REGEX = /^https:\/\/\*\.([a-zA-Z0-9.-]+)(?<path>\/[a-zA-Z0-9\-._~!$&'()*+,;=:@\/]*)?$/;

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

const normalizeUrl = (url: URL) => {
  url.hostname = url.hostname.toLowerCase();
  if (!url.pathname) {
    url.pathname = "/";
  }
  return url;
};

export const classifyRedirect = (value: string): { type: RedirectUriType; normalized: string } => {
  if (value.startsWith("https://*.")) {
    const match = HOST_WILDCARD_REGEX.exec(value);
    if (!match) {
      throw new DomainError("Invalid host wildcard redirect", { code: "invalid_redirect_uri" });
    }

    return { type: RedirectUriType.HOST_WILDCARD, normalized: value.toLowerCase() };
  }

  if (value.endsWith("/*")) {
    const withoutSuffix = value.slice(0, -1);
    const url = normalizeUrl(new URL(withoutSuffix));
    ensureSchemeAllowed(url);
    return { type: RedirectUriType.PATH_SUFFIX, normalized: `${url.origin}${url.pathname}*` };
  }

  const url = normalizeUrl(new URL(value));
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
  const url = normalizeUrl(new URL(candidate));
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

    return matchPathSuffix(redirect, url);
  });

  if (!match) {
    throw new DomainError("redirect_uri mismatch", { status: 400, code: "invalid_redirect_uri" });
  }

  return `${url.origin}${url.pathname}${url.search}`;
};
