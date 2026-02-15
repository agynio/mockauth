import { toResponse } from "@/server/errors";
import { getJwks } from "@/server/services/key-service";
import { getActiveTenantBySlug } from "@/server/services/tenant-service";
import type { TenantRouteContext } from "@/types/tenant-route";

export async function GET(_: Request, context: TenantRouteContext) {
  try {
    const { tenant: tenantSlug } = await context.params;
    const tenant = await getActiveTenantBySlug(tenantSlug);
    const keys = await getJwks(tenant.id);
    return Response.json({ keys });
  } catch (error) {
    return toResponse(error);
  }
}
