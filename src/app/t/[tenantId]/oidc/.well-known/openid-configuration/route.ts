import type { NextRequest } from "next/server";

import { resolveUrl } from "@/server/http/origin";
import { legacyIssuerRedirect } from "../../legacy-redirect";
import type { TenantRouteContext } from "@/types/tenant-route";

export async function GET(request: NextRequest, context: TenantRouteContext) {
  const { tenantId } = await context.params;
  const normalizedUrl = resolveUrl(request);
  const basePath = `/t/${tenantId}/oidc`;
  const suffixPath = normalizedUrl.pathname.startsWith(basePath)
    ? normalizedUrl.pathname.slice(basePath.length)
    : normalizedUrl.pathname;
  const suffix = `${suffixPath}${normalizedUrl.search}`;
  return legacyIssuerRedirect(request, tenantId, suffix || "/.well-known/openid-configuration");
}
