import type { NextRequest } from "next/server";
import { z } from "zod";

import { toResponse } from "@/server/errors";
import { handleAuthorize } from "@/server/services/authorize-service";
import { MOCK_SESSION_COOKIE } from "@/server/services/mock-session-service";
import { resolveUrl } from "@/server/http/origin";
import type { ApiResourceRouteContext } from "@/types/api-resource-route";
import { MOCK_REAUTH_COOKIE } from "@/server/oidc/reauth-cookie";

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
      },
      origin,
      normalizedUrl.toString(),
    );

    if (result.type === "login") {
      return Response.redirect(new URL(result.redirectTo, origin));
    }

    return Response.redirect(result.redirectTo);
  } catch (error) {
    return toResponse(error);
  }
}
