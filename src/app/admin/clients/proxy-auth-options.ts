import type { RHFSelectOption } from "@/components/rhf/rhf-select-field";

type TokenAuthMethodValue = "client_secret_basic" | "client_secret_post" | "none";

const LINKEDIN_HOST_SUFFIX = ".linkedin.com";
const LINKEDIN_ROOT = "linkedin.com";

export const PROXY_TOKEN_AUTH_OPTIONS: RHFSelectOption<TokenAuthMethodValue>[] = [
  {
    value: "client_secret_basic",
    label: "HTTP Basic (client_secret_basic)",
  },
  {
    value: "client_secret_post",
    label: "POST body (client_secret_post)",
  },
  {
    value: "none",
    label: "Public client (none)",
  },
];

export const isLinkedInTokenEndpoint = (tokenEndpoint: string | null | undefined): boolean => {
  if (!tokenEndpoint) {
    return false;
  }
  const trimmed = tokenEndpoint.trim();
  if (!trimmed) {
    return false;
  }
  try {
    const hostname = new URL(trimmed).hostname.toLowerCase();
    return hostname === LINKEDIN_ROOT || hostname.endsWith(LINKEDIN_HOST_SUFFIX);
  } catch {
    return false;
  }
};

export const getProxyTokenAuthDescription = (tokenEndpoint: string | null | undefined): string =>
  isLinkedInTokenEndpoint(tokenEndpoint)
    ? "LinkedIn commonly expects client_secret_post. Choose POST body if LinkedIn rejects HTTP Basic."
    : "Determines how MockAuth authenticates to the upstream token endpoint.";
