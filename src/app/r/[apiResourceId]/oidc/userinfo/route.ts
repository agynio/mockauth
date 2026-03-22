import type { NextRequest } from "next/server";

import { toResponse } from "@/server/errors";
import { preflightResponse, withCorsHeaders } from "@/server/http/cors";
import { getUserInfo } from "@/server/services/userinfo-service";
import { resolveOrigin } from "@/server/http/origin";
import type { ApiResourceRouteContext } from "@/types/api-resource-route";

export function OPTIONS(request: Request) {
  return preflightResponse(request);
}

export async function GET(request: NextRequest, context: ApiResourceRouteContext) {
  try {
    const { apiResourceId } = await context.params;
    const data = await getUserInfo(request.headers.get("authorization"), resolveOrigin(request), apiResourceId);
    return withCorsHeaders(Response.json(data), request);
  } catch (error) {
    return withCorsHeaders(toResponse(error), request);
  }
}
