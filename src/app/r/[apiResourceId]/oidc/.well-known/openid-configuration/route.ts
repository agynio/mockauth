import { buildDiscoveryDocument } from "@/server/services/discovery-service";
import { toResponse } from "@/server/errors";
import { preflightResponse, withCorsHeaders } from "@/server/http/cors";
import { resolveOrigin } from "@/server/http/origin";
import { getApiResourceWithTenant } from "@/server/services/api-resource-service";
import type { ApiResourceRouteContext } from "@/types/api-resource-route";

export function OPTIONS(request: Request) {
  return preflightResponse(request);
}

export async function GET(request: Request, context: ApiResourceRouteContext) {
  try {
    const { apiResourceId } = await context.params;
    const origin = resolveOrigin(request);
    await getApiResourceWithTenant(apiResourceId);
    const doc = buildDiscoveryDocument(origin, apiResourceId);
    return withCorsHeaders(Response.json(doc), request);
  } catch (error) {
    return withCorsHeaders(toResponse(error), request);
  }
}
