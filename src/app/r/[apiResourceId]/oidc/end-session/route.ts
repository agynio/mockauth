import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { toResponse } from "@/server/errors";
import { resolveUrl } from "@/server/http/origin";
import { handleEndSession } from "@/server/services/end-session-service";
import { MOCK_SESSION_COOKIE } from "@/server/services/mock-session-service";
import type { ApiResourceRouteContext } from "@/types/api-resource-route";

const endSessionSchema = z.object({
  id_token_hint: z.string().min(1).optional(),
  post_logout_redirect_uri: z.string().min(1).optional(),
  client_id: z.string().min(1).optional(),
  state: z.string().min(1).optional(),
});

const buildResponse = (result: Awaited<ReturnType<typeof handleEndSession>>, normalizedUrl: URL) => {
  const response =
    result.type === "redirect"
      ? NextResponse.redirect(result.redirectTo, { status: 302 })
      : new NextResponse(result.html, {
          status: 200,
          headers: {
            "content-type": "text/html; charset=utf-8",
          },
        });

  if (result.clearSessionCookie) {
    response.cookies.set({
      name: MOCK_SESSION_COOKIE,
      value: "",
      path: "/r",
      httpOnly: true,
      sameSite: "lax",
      secure: normalizedUrl.protocol === "https:",
      maxAge: 0,
    });
  }

  return response;
};

const handleRequest = async (
  request: NextRequest,
  context: ApiResourceRouteContext,
  data: z.infer<typeof endSessionSchema>,
  normalizedUrl: URL,
) => {
  try {
    const { apiResourceId } = await context.params;
    const sessionToken = request.cookies.get(MOCK_SESSION_COOKIE)?.value;
    const result = await handleEndSession(
      {
        apiResourceId,
        idTokenHint: data.id_token_hint,
        postLogoutRedirectUri: data.post_logout_redirect_uri,
        clientId: data.client_id,
        state: data.state,
        sessionToken,
      },
      normalizedUrl.origin,
    );

    return buildResponse(result, normalizedUrl);
  } catch (error) {
    return toResponse(error);
  }
};

export async function GET(request: NextRequest, context: ApiResourceRouteContext) {
  const normalizedUrl = resolveUrl(request);
  const validation = endSessionSchema.safeParse(Object.fromEntries(normalizedUrl.searchParams.entries()));

  if (!validation.success) {
    return Response.json({ error: "invalid_request", details: validation.error.flatten() }, { status: 400 });
  }

  return handleRequest(request, context, validation.data, normalizedUrl);
}

export async function POST(request: NextRequest, context: ApiResourceRouteContext) {
  const formEntries = Array.from((await request.clone().formData()).entries(), ([key, value]) => [
    key,
    typeof value === "string" ? value : value.name,
  ]) as Array<[string, string]>;
  const validation = endSessionSchema.safeParse(Object.fromEntries(formEntries));

  if (!validation.success) {
    return Response.json({ error: "invalid_request", details: validation.error.flatten() }, { status: 400 });
  }

  const normalizedUrl = resolveUrl(request);
  return handleRequest(request, context, validation.data, normalizedUrl);
}
