export const issuerForResource = (origin: string, tenantId: string, apiResourceId: string) => {
  return `${origin}/t/${tenantId}/r/${apiResourceId}/oidc`;
};

export const legacyTenantIssuer = (origin: string, tenantId: string) => {
  return `${origin}/t/${tenantId}/oidc`;
};

export const parseIssuerSegments = (value: string) => {
  const url = new URL(value);
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length >= 5 && segments[0] === "t" && segments[2] === "r" && segments[4] === "oidc") {
    return { tenantId: segments[1], apiResourceId: segments[3], isLegacy: false };
  }
  if (segments.length >= 3 && segments[0] === "t" && segments[2] === "oidc") {
    return { tenantId: segments[1], apiResourceId: null, isLegacy: true };
  }
  throw new Error("Invalid issuer format");
};
