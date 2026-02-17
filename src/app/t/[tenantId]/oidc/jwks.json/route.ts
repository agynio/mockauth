import { toResponse } from "@/server/errors";
import { getJwks } from "@/server/services/key-service";
import { getActiveTenantById } from "@/server/services/tenant-service";
import type { TenantRouteContext } from "@/types/tenant-route";

export async function GET(_: Request, context: TenantRouteContext) {
  try {
    const { tenantId } = await context.params;
    const tenant = await getActiveTenantById(tenantId);
    const keys = await getJwks(tenant.id);
    return Response.json({ keys });
  } catch (error) {
    return toResponse(error);
  }
}
