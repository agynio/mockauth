import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { toResponse } from "@/server/errors";
import { handleAuthorize } from "@/server/services/authorize-service";
import { MOCK_SESSION_COOKIE } from "@/server/services/mock-session-service";
import { resolveUrl } from "@/server/http/origin";
import type { ApiResourceRouteContext } from "@/types/api-resource-route";
import { buildReauthCookiePath, MOCK_FRESH_LOGIN_COOKIE, MOCK_REAUTH_COOKIE } from "@/server/oidc/reauth-cookie";

const authorizeSchema = z.object({
  client_id: z.string().min(1),
  redirect_uri: z.string().min(1),
  response_type: z.string().default("code"),
  scope: z.string().min(1),
  state: z.string().optional(),
  nonce: z.string().optional(),
  prompt: z.enum(["login", "none"]).optional(),
  code_challenge: z.string().min(43).max(128),
  code_challenge_method: z.string().default("S256"),
  fresh_login: z.string().optional(),
});

export async function GET(request: NextRequest, context: ApiResourceRouteContext) {
  const normalizedUrl = resolveUrl(request);
  const origin = normalizedUrl.origin;
  const validation = authorizeSchema.safeParse(Object.fromEntries(normalizedUrl.searchParams.entries()));

  if (!validation.success) {
    return Response.json({ error: "invalid_request", details: validation.error.flatten() }, { status: 400 });
  }

  try {
    const { apiResourceId } = await context.params;
    const sessionToken = request.cookies.get(MOCK_SESSION_COOKIE)?.value;
    const reauthCookie = request.cookies.get(MOCK_REAUTH_COOKIE)?.value;
    const freshLoginCookie = request.cookies.get(MOCK_FRESH_LOGIN_COOKIE)?.value;
    const freshLoginRequested = validation.data.fresh_login === "1";
    const result = await handleAuthorize(
      {
        apiResourceId,
        clientId: validation.data.client_id,
        redirectUri: validation.data.redirect_uri,
        responseType: validation.data.response_type,
        scope: validation.data.scope,
        state: validation.data.state,
        nonce: validation.data.nonce,
        codeChallenge: validation.data.code_challenge,
        codeChallengeMethod: validation.data.code_challenge_method,
        prompt: validation.data.prompt,
        sessionToken,
        reauthCookie,
        freshLoginCookie,
        freshLoginRequested,
      },
      origin,
      normalizedUrl.toString(),
    );

    if (result.type === "login") {
      const response = NextResponse.redirect(new URL(result.redirectTo, origin), { status: 302 });
      if (result.consumeFreshLoginCookie) {
        response.cookies.set({
          name: MOCK_FRESH_LOGIN_COOKIE,
          value: "",
          path: buildReauthCookiePath(apiResourceId),
          httpOnly: true,
          sameSite: "lax",
          secure: normalizedUrl.protocol === "https:",
          maxAge: 0,
        });
      }
      return response;
    }

    const response = NextResponse.redirect(result.redirectTo, { status: 302 });
    if (result.consumeFreshLoginCookie) {
      response.cookies.set({
        name: MOCK_FRESH_LOGIN_COOKIE,
        value: "",
        path: buildReauthCookiePath(apiResourceId),
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
