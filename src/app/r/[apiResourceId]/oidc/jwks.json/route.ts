import { toResponse } from "@/server/errors";
import { preflightResponse, withCorsHeaders } from "@/server/http/cors";
import { getJwks } from "@/server/services/key-service";
import { getApiResourceWithTenant } from "@/server/services/api-resource-service";
import type { ApiResourceRouteContext } from "@/types/api-resource-route";

export function OPTIONS(request: Request) {
  return preflightResponse(request);
}

export async function GET(request: Request, context: ApiResourceRouteContext) {
  try {
    const { apiResourceId } = await context.params;
    const { tenant } = await getApiResourceWithTenant(apiResourceId);
    const keys = await getJwks(tenant.id);
    return withCorsHeaders(Response.json({ keys }), request);
  } catch (error) {
    return withCorsHeaders(toResponse(error), request);
  }
}
