import { RedirectUriType } from "@/generated/prisma/client";
import { DomainError } from "@/server/errors";
import { allowAnyRedirects } from "@/server/oidc/redirect-policy";
import {
  ANY_REDIRECT_VALUE,
  HOST_WILDCARD_PREFIX,
  HOST_WILDCARD_REGEX,
  PATH_WILDCARD_SUFFIX,
  PORT_WILDCARD_SUFFIX,
  isLoopbackHost,
  splitPortWildcard,
} from "@/server/oidc/redirect-uri-syntax";

const HTTPS_DEFAULT_PORT = 443;
const MAX_PORT = 65535;

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

  if (url.protocol === "http:" && isLoopbackHost(host)) {
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

/** Origin of a stored entry, keeping the ":*" port wildcard when one was configured. */
const buildOrigin = (url: URL, anyPort: boolean) => (anyPort ? `${url.origin}${PORT_WILDCARD_SUFFIX}` : url.origin);

const normalizeWildcardPort = (port: string | undefined) => {
  if (!port) {
    return "";
  }
  if (port === ANY_REDIRECT_VALUE) {
    return PORT_WILDCARD_SUFFIX;
  }

  const numeric = Number(port);
  if (!Number.isInteger(numeric) || numeric < 1 || numeric > MAX_PORT) {
    throw new DomainError("redirect_uri has an invalid port", { code: "invalid_redirect_uri" });
  }
  return numeric === HTTPS_DEFAULT_PORT ? "" : `:${numeric}`;
};

const normalizeHostWildcard = (value: string) => {
  if (value.endsWith(PATH_WILDCARD_SUFFIX)) {
    throw new DomainError("Host wildcards do not support path wildcards", { code: "invalid_redirect_uri" });
  }
  const normalizedScheme = value.replace(/^https:\/\//i, "https://");
  const match = HOST_WILDCARD_REGEX.exec(normalizedScheme);
  const host = match?.groups?.host;
  if (!match || !host) {
    throw new DomainError("Invalid host wildcard redirect", { code: "invalid_redirect_uri" });
  }

  const path = match.groups?.path ?? "/";
  return `https://*.${host.toLowerCase()}${normalizeWildcardPort(match.groups?.port)}${path}`;
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

  if (schemeNormalized.startsWith(HOST_WILDCARD_PREFIX)) {
    if (trimmed.includes("?")) {
      throw new DomainError("Host wildcards cannot include query parameters", { code: "invalid_redirect_uri" });
    }
    if (trimmed.includes("#")) {
      throw new DomainError("Host wildcards cannot include fragment", { code: "invalid_redirect_uri" });
    }
    return { type: RedirectUriType.HOST_WILDCARD, normalized: normalizeHostWildcard(trimmed) };
  }

  const { value: withoutPortWildcard, anyPort } = splitPortWildcard(trimmed);

  if (withoutPortWildcard.endsWith(PATH_WILDCARD_SUFFIX)) {
    const url = normalizeUrl(parseUrl(withoutPortWildcard.slice(0, -1)));
    ensureSchemeAllowed(url);
    if (url.search) {
      throw new DomainError("Path wildcards cannot include query parameters", { code: "invalid_redirect_uri" });
    }
    return { type: RedirectUriType.PATH_SUFFIX, normalized: `${buildOrigin(url, anyPort)}${url.pathname}*` };
  }

  const url = normalizeUrl(parseUrl(withoutPortWildcard));
  ensureSchemeAllowed(url);
  return {
    type: RedirectUriType.EXACT,
    normalized: `${buildOrigin(url, anyPort)}${url.pathname}${url.search}`,
  };
};

type RedirectRecord = {
  uri: string;
  type: RedirectUriType;
  enabled: boolean;
};

type RedirectPattern = { url: URL; anyPort: boolean };

const parsePattern = (value: string): RedirectPattern | null => {
  const { value: withoutPortWildcard, anyPort } = splitPortWildcard(value);
  try {
    const url = new URL(withoutPortWildcard);
    url.hostname = url.hostname.toLowerCase();
    return { url, anyPort };
  } catch {
    return null;
  }
};

const matchAuthority = (pattern: RedirectPattern, candidate: URL): boolean =>
  candidate.protocol === pattern.url.protocol &&
  candidate.hostname === pattern.url.hostname &&
  (pattern.anyPort || candidate.port === pattern.url.port);

const matchWildcardPort = (port: string | undefined, candidatePort: string): boolean => {
  if (port === ANY_REDIRECT_VALUE) {
    return true;
  }
  if (!port) {
    return candidatePort === "";
  }
  return candidatePort === String(Number(port));
};

const matchHostWildcard = (record: RedirectRecord, candidate: URL): boolean => {
  const match = HOST_WILDCARD_REGEX.exec(record.uri);
  const base = match?.groups?.host;
  if (!match || !base) {
    return false;
  }

  if (candidate.protocol !== "https:") {
    return false;
  }

  if (!matchWildcardPort(match.groups?.port, candidate.port)) {
    return false;
  }

  const baseLabels = base.toLowerCase().split(".");
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
  const pattern = parsePattern(record.uri.slice(0, -1)); // remove the '*'
  if (!pattern || !matchAuthority(pattern, candidate)) {
    return false;
  }
  return candidate.pathname.startsWith(pattern.url.pathname);
};

const matchExact = (record: RedirectRecord, candidate: URL): boolean => {
  const pattern = parsePattern(record.uri);
  if (!pattern || !matchAuthority(pattern, candidate)) {
    return false;
  }
  return candidate.pathname === pattern.url.pathname && candidate.search === pattern.url.search;
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
