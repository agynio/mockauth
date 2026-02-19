export type TenantRouteContext = {
  params: Promise<{ tenantId: string }>;
};

export type TenantResourceRouteContext = {
  params: Promise<{ tenantId: string; apiResourceId: string }>;
};
