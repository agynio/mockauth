export type RequestContext = {
  ipAddress?: string | null;
  userAgent?: string | null;
};

const headerValue = (headers: Headers | Record<string, string>, name: string): string | null => {
  if (headers instanceof Headers) {
    return headers.get(name);
  }
  const value = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1];
  return value ?? null;
};

export const buildRequestContext = (
  headers: Headers | Record<string, string>,
  ipOverride?: string | null,
): RequestContext => {
  const forwardedFor = headerValue(headers, "x-forwarded-for");
  const ipAddress = ipOverride ?? forwardedFor?.split(",")[0]?.trim() ?? null;
  const userAgent = headerValue(headers, "user-agent");
  return {
    ipAddress,
    userAgent: userAgent ?? null,
  };
};
