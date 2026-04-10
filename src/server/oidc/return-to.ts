const buildAuthorizePath = (apiResourceId: string) => `/r/${apiResourceId}/oidc/authorize`;

type ReturnToOptions = {
  apiResourceId: string;
  origin: string;
};

export const parseAuthorizeReturnTo = (value: string | undefined, options: ReturnToOptions): URL | null => {
  if (!value) {
    return null;
  }

  try {
    const parsed = new URL(value, options.origin);
    if (parsed.origin !== options.origin) {
      return null;
    }
    if (parsed.pathname !== buildAuthorizePath(options.apiResourceId)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};

export const resolveAuthorizeReturnTo = (value: string | undefined, options: ReturnToOptions): URL => {
  return parseAuthorizeReturnTo(value, options) ?? new URL(buildAuthorizePath(options.apiResourceId), options.origin);
};

export const toRelativeReturnTo = (url: URL) => `${url.pathname}${url.search}${url.hash}`;
