export const issuerForTenant = (origin: string, tenantSlug: string) => {
  return `${origin}/t/${tenantSlug}/oidc`;
};
