import type { NextRequest } from "next/server";

import { toResponse } from "@/server/errors";
import { getUserInfo } from "@/server/services/userinfo-service";
import { resolveOrigin } from "@/server/http/origin";
import type { TenantResourceRouteContext } from "@/types/tenant-route";

export async function GET(request: NextRequest, context: TenantResourceRouteContext) {
  try {
    const { tenantId, apiResourceId } = await context.params;
    const data = await getUserInfo(
      request.headers.get("authorization"),
      resolveOrigin(request),
      tenantId,
      apiResourceId,
    );
    return Response.json(data);
  } catch (error) {
    return toResponse(error);
  }
}
