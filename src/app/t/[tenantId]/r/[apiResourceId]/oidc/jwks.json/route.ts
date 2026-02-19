import { toResponse } from "@/server/errors";
import { getJwks } from "@/server/services/key-service";
import { getActiveTenantById } from "@/server/services/tenant-service";
import { getApiResourceForTenant } from "@/server/services/api-resource-service";
import type { TenantResourceRouteContext } from "@/types/tenant-route";

export async function GET(_: Request, context: TenantResourceRouteContext) {
  try {
    const { tenantId, apiResourceId } = await context.params;
    await getApiResourceForTenant(tenantId, apiResourceId);
    const tenant = await getActiveTenantById(tenantId);
    const keys = await getJwks(tenant.id);
    return Response.json({ keys });
  } catch (error) {
    return toResponse(error);
  }
}
