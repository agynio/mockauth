export const issuerForTenant = (origin: string, tenantId: string) => {
  return `${origin}/t/${tenantId}/oidc`;
};
