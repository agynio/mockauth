import { toResponse } from "@/server/errors";
import { getJwks } from "@/server/services/key-service";
import { getApiResourceWithTenant } from "@/server/services/api-resource-service";
import type { ApiResourceRouteContext } from "@/types/api-resource-route";

export async function GET(_: Request, context: ApiResourceRouteContext) {
  try {
    const { apiResourceId } = await context.params;
    const { tenant } = await getApiResourceWithTenant(apiResourceId);
    const keys = await getJwks(tenant.id);
    return Response.json({ keys });
  } catch (error) {
    return toResponse(error);
  }
}
