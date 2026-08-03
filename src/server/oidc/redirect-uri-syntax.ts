// Pure syntax helpers for redirect entries. Kept free of server-only imports so the
// Admin client components can share the same shapes as the OIDC matcher.

export const ANY_REDIRECT_VALUE = "*";
export const PATH_WILDCARD_SUFFIX = "/*";
export const PORT_WILDCARD_SUFFIX = ":*";
export const HOST_WILDCARD_PREFIX = "https://*.";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export const HOST_WILDCARD_REGEX =
  /^https:\/\/\*\.(?<host>[a-zA-Z0-9.-]+)(?::(?<port>\*|\d{1,5}))?(?<path>\/[a-zA-Z0-9\-._~!$&'()*+,;=:@\/]*)?$/;

// Matches a ":*" port wildcard in the authority only, e.g. http://localhost:*/callback.
const PORT_WILDCARD_AUTHORITY_REGEX = /^([a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^/?#]+):\*(?=$|[/?#])/;

// URL.hostname keeps IPv6 literals bracketed ("[::1]"), so compare on the bare host.
export const isLoopbackHost = (hostname: string) =>
  LOCAL_HOSTS.has(hostname.toLowerCase().replace(/^\[(.*)\]$/, "$1"));

/** Removes a ":*" port wildcard so the remainder can be parsed with `new URL`. */
export const splitPortWildcard = (value: string): { value: string; anyPort: boolean } => {
  const match = PORT_WILDCARD_AUTHORITY_REGEX.exec(value);
  const authority = match?.[1];
  if (!match || !authority) {
    return { value, anyPort: false };
  }
  return { value: `${authority}${value.slice(match[0].length)}`, anyPort: true };
};

export const hasPortWildcard = (value: string) => splitPortWildcard(value).anyPort;

/** Hostname of a redirect entry, tolerating wildcards. Returns null when unparseable. */
export const redirectHostname = (value: string): string | null => {
  const { value: withoutPortWildcard } = splitPortWildcard(value.trim());
  try {
    return new URL(withoutPortWildcard).hostname.toLowerCase();
  } catch {
    return null;
  }
};
