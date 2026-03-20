import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { toResponse } from "@/server/errors";
import { handleProxyCallback } from "@/server/services/proxy-callback-service";
import { resolveUrl } from "@/server/http/origin";
import type { ApiResourceRouteContext } from "@/types/api-resource-route";
import { PROXY_TRANSACTION_COOKIE, buildProxyTransactionCookiePath } from "@/server/oidc/proxy/constants";
import { buildRequestContext } from "@/server/utils/request-context";
import { searchParamsToRecord } from "@/server/utils/search-params";

const callbackSchema = z.object({
  state: z.string().min(1),
  code: z.string().optional(),
  error: z.string().optional(),
  error_description: z.string().optional(),
});

export async function GET(request: NextRequest, context: ApiResourceRouteContext) {
  const normalizedUrl = resolveUrl(request);
  const query = callbackSchema.safeParse(Object.fromEntries(normalizedUrl.searchParams.entries()));

  if (!query.success) {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }

  try {
    const { apiResourceId } = await context.params;
    const transactionCookie = request.cookies.get(PROXY_TRANSACTION_COOKIE)?.value;
    const callbackParams = searchParamsToRecord(normalizedUrl.searchParams);
    const requestHeaders = Object.fromEntries(request.headers.entries());
    const result = await handleProxyCallback({
      apiResourceId,
      state: query.data.state,
      code: query.data.code,
      providerError: query.data.error,
      providerErrorDescription: query.data.error_description,
      transactionCookie,
      origin: normalizedUrl.origin,
      callbackRequest: {
        url: normalizedUrl.toString(),
        headers: requestHeaders,
        contentType: null,
        body: null,
      },
      callbackParams,
      requestContext: buildRequestContext(request.headers, (request as { ip?: string | null }).ip ?? null),
    });

    const response = NextResponse.redirect(result.redirectTo, { status: 302 });
    if (result.clearTransactionCookie) {
      response.cookies.set({
        name: PROXY_TRANSACTION_COOKIE,
        value: "",
        path: buildProxyTransactionCookiePath(apiResourceId),
        httpOnly: true,
        sameSite: "lax",
        secure: normalizedUrl.protocol === "https:",
        maxAge: 0,
      });
    }

    return response;
  } catch (error) {
    return toResponse(error);
  }
}
