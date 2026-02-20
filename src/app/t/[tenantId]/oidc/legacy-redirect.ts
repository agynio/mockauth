import { DomainError } from "@/server/errors";
import { resolveUrl } from "@/server/http/origin";
import { getActiveTenantById } from "@/server/services/tenant-service";

const legacyMessage = (origin: string) => ({
  error: "tenant_id_required",
  message:
    "Tenant slug routing was removed in Stage 2. Open the Admin UI to copy the tenantId-based issuer and discovery URLs.",
  adminUrl: new URL("/admin/clients", origin).toString(),
});

export const legacyIssuerRedirect = async (request: Request, tenantId: string, suffix: string) => {
  const normalizedUrl = resolveUrl(request);
  try {
    const tenant = await getActiveTenantById(tenantId);
    const location = new URL(`/t/${tenant.id}/r/${tenant.defaultApiResourceId}/oidc${suffix}`, normalizedUrl.origin);
    return Response.redirect(location, 308);
  } catch (error) {
    if (error instanceof DomainError && error.options.code === "tenant_not_found") {
      return Response.json(legacyMessage(normalizedUrl.origin), { status: 410 });
    }
    throw error;
  }
};
