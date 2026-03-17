const LINKEDIN_HOST_SUFFIX = "linkedin.com";

const detectHostname = (value: string | null | undefined): string | null => {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  try {
    return new URL(trimmed).hostname.toLowerCase();
  } catch (error) {
    return null;
  }
};

export const isLinkedInTokenEndpoint = (value: string | null | undefined): boolean => {
  const hostname = detectHostname(value);
  if (!hostname) {
    return false;
  }

  return hostname === LINKEDIN_HOST_SUFFIX || hostname.endsWith(`.${LINKEDIN_HOST_SUFFIX}`);
};
