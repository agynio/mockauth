export const issuerForResource = (origin: string, apiResourceId: string) => {
  return `${origin}/r/${apiResourceId}/oidc`;
};

export const parseIssuerSegments = (value: string) => {
  const url = new URL(value);
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length >= 3 && segments[0] === "r" && segments[2] === "oidc") {
    return { apiResourceId: segments[1] };
  }
  throw new Error("Invalid issuer format");
};
