import { buildDiscoveryDocument } from "@/server/services/discovery-service";
import { resolveOrigin } from "@/server/http/origin";
import type { TenantRouteContext } from "@/types/tenant-route";

export async function GET(request: Request, context: TenantRouteContext) {
  const url = new URL(request.url);
  const { tenant } = await context.params;
  const doc = buildDiscoveryDocument(resolveOrigin(request), tenant);
  return Response.json(doc);
}
