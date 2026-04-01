import { NextResponse, type NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";

import { authOptions } from "@/server/auth/options";
import { toResponse } from "@/server/errors";
import { resolveUrl } from "@/server/http/origin";
import {
  PREAUTHORIZED_ADMIN_TRANSACTION_COOKIE,
  buildPreauthorizedAdminTransactionCookiePath,
} from "@/server/oidc/preauthorized/constants";
import { getAdminTenantContext } from "@/server/services/admin-tenant-context";
import { completePreauthorizedAdminAuth } from "@/server/services/preauthorized-admin-auth-service";
import { getRequestContextFromRequest } from "@/server/utils/request-context";
import { searchParamsToRecord } from "@/server/utils/search-params";

const callbackSchema = z.object({
  state: z.string().min(1),
  code: z.string().optional(),
  error: z.string().optional(),
  error_description: z.string().optional(),
});

const routeParamsSchema = z.object({ apiResourceId: z.string().min(1) });

type RouteParams = { params: Promise<{ apiResourceId: string }> };

export async function GET(request: NextRequest, { params }: RouteParams) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsedParams = routeParamsSchema.safeParse(await params);
  if (!parsedParams.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const { apiResourceId } = parsedParams.data;
  const normalizedUrl = resolveUrl(request);
  const query = callbackSchema.safeParse(Object.fromEntries(normalizedUrl.searchParams.entries()));
  if (!query.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const { activeTenant, activeMembership } = await getAdminTenantContext(session.user.id);
  if (!activeTenant || !activeMembership) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (activeMembership.role !== "OWNER" && activeMembership.role !== "WRITER") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const transactionCookie = request.cookies.get(PREAUTHORIZED_ADMIN_TRANSACTION_COOKIE)?.value;
    const callbackParams = searchParamsToRecord(normalizedUrl.searchParams);
    const requestHeaders = Object.fromEntries(request.headers.entries());
    const { clientId } = await completePreauthorizedAdminAuth({
      tenantId: activeTenant.id,
      apiResourceId,
      adminUserId: session.user.id,
      state: query.data.state,
      code: query.data.code,
      providerError: query.data.error,
      providerErrorDescription: query.data.error_description,
      transactionCookie,
      callbackRequest: {
        url: normalizedUrl.toString(),
        headers: requestHeaders,
        contentType: null,
        body: null,
      },
      callbackParams,
      requestContext: getRequestContextFromRequest(request),
    });

    const response = NextResponse.redirect(new URL(`/admin/clients/${clientId}`, normalizedUrl).toString(), {
      status: 302,
    });
    response.cookies.set({
      name: PREAUTHORIZED_ADMIN_TRANSACTION_COOKIE,
      value: "",
      path: buildPreauthorizedAdminTransactionCookiePath(apiResourceId),
      httpOnly: true,
      sameSite: "lax",
      secure: normalizedUrl.protocol === "https:",
      maxAge: 0,
    });
    return response;
  } catch (error) {
    return toResponse(error);
  }
}
