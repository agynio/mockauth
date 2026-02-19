import type { NextRequest } from "next/server";
import { z } from "zod";

import { toResponse } from "@/server/errors";
import { consumeAuthorizationCode } from "@/server/services/authorization-code-service";
import { issueTokensFromCode } from "@/server/services/token-service";
import { resolveOrigin } from "@/server/http/origin";
import type { TenantResourceRouteContext } from "@/types/tenant-route";

const tokenSchema = z.object({
  grant_type: z.literal("authorization_code"),
  code: z.string().min(10),
  redirect_uri: z.string().min(1),
  code_verifier: z.string().min(43).max(128),
  client_id: z.string().optional(),
  client_secret: z.string().optional(),
});

const parseBasicAuth = (header: string | null) => {
  if (!header) {
    return null;
  }

  const [scheme, value] = header.split(" ");
  if (scheme !== "Basic" || !value) {
    return null;
  }

  const decoded = Buffer.from(value, "base64").toString("utf8");
  const [id, secret] = decoded.split(":");
  return { clientId: id, clientSecret: secret };
};

export async function POST(request: NextRequest, context: TenantResourceRouteContext) {
  const entries = Object.fromEntries((await request.clone().formData()).entries());
  const validation = tokenSchema.safeParse(entries);

  if (!validation.success) {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }

  try {
    const basic = parseBasicAuth(request.headers.get("authorization"));
    const clientId = basic?.clientId ?? validation.data.client_id;
    const clientSecret = basic?.clientSecret ?? validation.data.client_secret;

    const { tenantId, apiResourceId } = await context.params;
    const codeRecord = await consumeAuthorizationCode(validation.data.code);
    if (codeRecord.tenantId !== tenantId || codeRecord.apiResourceId !== apiResourceId) {
      return Response.json({ error: "invalid_grant" }, { status: 400 });
    }

    if (clientId && codeRecord.client.clientId !== clientId) {
      return Response.json({ error: "invalid_client" }, { status: 401 });
    }

    const authMethod = basic ? "client_secret_basic" : validation.data.client_secret ? "client_secret_post" : "none";
    if (codeRecord.client.tokenEndpointAuthMethod !== authMethod) {
      return Response.json({ error: "invalid_client" }, { status: 401 });
    }

    const tokens = await issueTokensFromCode({
      code: codeRecord,
      codeVerifier: validation.data.code_verifier,
      redirectUri: validation.data.redirect_uri,
      clientSecret,
      origin: resolveOrigin(request),
    });

    return Response.json(tokens);
  } catch (error) {
    return toResponse(error);
  }
}
