import { buildDiscoveryDocument } from "@/server/services/discovery-service";
import { resolveOrigin } from "@/server/http/origin";
import { getActiveTenantById } from "@/server/services/tenant-service";
import { DomainError } from "@/server/errors";
import type { TenantRouteContext } from "@/types/tenant-route";

export async function GET(request: Request, context: TenantRouteContext) {
  const { tenantId } = await context.params;
  const origin = resolveOrigin(request);
  const adminUrl = new URL("/admin/clients", origin).toString();

  try {
    await getActiveTenantById(tenantId);
  } catch (error) {
    if (error instanceof DomainError && error.options.code === "tenant_not_found") {
      return Response.json(
        {
          error: "tenant_id_required",
          message:
            "Tenant slug routing was removed in Stage 2. Open the Admin UI to copy the tenantId-based issuer and discovery URLs.",
          adminUrl,
        },
        { status: 410 },
      );
    }
    throw error;
  }

  const doc = buildDiscoveryDocument(origin, tenantId);
  return Response.json(doc);
}
