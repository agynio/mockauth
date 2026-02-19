import { buildDiscoveryDocument } from "@/server/services/discovery-service";
import { resolveOrigin } from "@/server/http/origin";
import { getActiveTenantById } from "@/server/services/tenant-service";
import { getApiResourceForTenant } from "@/server/services/api-resource-service";
import type { TenantResourceRouteContext } from "@/types/tenant-route";

export async function GET(request: Request, context: TenantResourceRouteContext) {
  const { tenantId, apiResourceId } = await context.params;
  const origin = resolveOrigin(request);
  await getActiveTenantById(tenantId);
  await getApiResourceForTenant(tenantId, apiResourceId);
  const doc = buildDiscoveryDocument(origin, tenantId, apiResourceId);
  return Response.json(doc);
}
