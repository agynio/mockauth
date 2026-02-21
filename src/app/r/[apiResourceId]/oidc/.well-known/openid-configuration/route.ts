import { buildDiscoveryDocument } from "@/server/services/discovery-service";
import { resolveOrigin } from "@/server/http/origin";
import { getApiResourceWithTenant } from "@/server/services/api-resource-service";
import type { ApiResourceRouteContext } from "@/types/api-resource-route";

export async function GET(request: Request, context: ApiResourceRouteContext) {
  const { apiResourceId } = await context.params;
  const origin = resolveOrigin(request);
  await getApiResourceWithTenant(apiResourceId);
  const doc = buildDiscoveryDocument(origin, apiResourceId);
  return Response.json(doc);
}
