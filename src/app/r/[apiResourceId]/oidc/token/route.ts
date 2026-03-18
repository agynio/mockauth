import type { NextRequest } from "next/server";
import { z } from "zod";

import { toResponse } from "@/server/errors";
import { consumeAuthorizationCode } from "@/server/services/authorization-code-service";
import { issueTokensFromCode } from "@/server/services/token-service";
import { resolveOrigin } from "@/server/http/origin";
import type { ApiResourceRouteContext } from "@/types/api-resource-route";
import {
  isProxyCode,
  completeProxyAuthorizationCodeGrant,
  completeProxyRefreshGrant,
} from "@/server/services/proxy-token-service";
import { recordSecurityViolation } from "@/server/services/audit-service";
import { getRequestContextFromRequest } from "@/server/utils/request-context";

const authorizationCodeSchema = z.object({
  grant_type: z.literal("authorization_code"),
  code: z.string().min(10),
  redirect_uri: z.string().min(1),
  code_verifier: z.string().min(43).max(128),
  client_id: z.string().optional(),
  client_secret: z.string().optional(),
});

const refreshTokenSchema = z.object({
  grant_type: z.literal("refresh_token"),
  refresh_token: z.string().min(10),
  scope: z.string().optional(),
  client_id: z.string().optional(),
  client_secret: z.string().optional(),
});

const tokenSchema = z.union([authorizationCodeSchema, refreshTokenSchema]);

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

export async function POST(request: NextRequest, context: ApiResourceRouteContext) {
  const entries = Object.fromEntries((await request.clone().formData()).entries());
  const validation = tokenSchema.safeParse(entries);

  if (!validation.success) {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }

  try {
    const basic = parseBasicAuth(request.headers.get("authorization"));
    const clientId = basic?.clientId ?? validation.data.client_id ?? null;
    const clientSecret = basic?.clientSecret ?? validation.data.client_secret ?? null;
    const requestContext = getRequestContextFromRequest(request);
    const clientSecretInBody = Boolean(validation.data.client_secret);
    const clientIdProvided = Boolean(clientId);

    const { apiResourceId } = await context.params;
    const authMethod = basic ? "client_secret_basic" : clientSecret ? "client_secret_post" : "none";

    if (validation.data.grant_type === "authorization_code") {
      const proxy = await isProxyCode(validation.data.code);
      if (proxy) {
        const tokens = await completeProxyAuthorizationCodeGrant({
          apiResourceId,
          code: validation.data.code,
          redirectUri: validation.data.redirect_uri,
          codeVerifier: validation.data.code_verifier,
          authMethod,
          clientIdFromRequest: clientId,
          clientSecret,
          auditContext: { requestContext, clientSecretInBody, clientIdProvided },
        });

        return Response.json(tokens);
      }

      const codeRecord = await consumeAuthorizationCode(validation.data.code);
      if (codeRecord.apiResourceId !== apiResourceId) {
        void recordSecurityViolation({
          tenantId: codeRecord.tenantId,
          clientId: codeRecord.clientId,
          traceId: codeRecord.traceId ?? null,
          reason: "issuer_mismatch",
          authMethod,
          clientSecretInBody,
          requestContext,
        });
        return Response.json({ error: "invalid_grant" }, { status: 400 });
      }

      if (clientId && codeRecord.client.clientId !== clientId) {
        void recordSecurityViolation({
          tenantId: codeRecord.tenantId,
          clientId: codeRecord.clientId,
          traceId: codeRecord.traceId ?? null,
          reason: "client_mismatch",
          authMethod,
          clientSecretInBody,
          requestContext,
        });
        return Response.json({ error: "invalid_client" }, { status: 401 });
      }

      if (codeRecord.client.tokenEndpointAuthMethod !== authMethod) {
        void recordSecurityViolation({
          tenantId: codeRecord.tenantId,
          clientId: codeRecord.clientId,
          traceId: codeRecord.traceId ?? null,
          reason: "auth_method_mismatch",
          authMethod,
          clientSecretInBody,
          requestContext,
        });
        return Response.json({ error: "invalid_client" }, { status: 401 });
      }

      const tokens = await issueTokensFromCode({
        code: codeRecord,
        codeVerifier: validation.data.code_verifier,
        redirectUri: validation.data.redirect_uri,
        clientSecret,
        origin: resolveOrigin(request),
        auditContext: { requestContext, authMethod, clientSecretInBody, clientIdProvided },
      });

      return Response.json(tokens);
    }

    if (!clientId) {
      return Response.json({ error: "invalid_client" }, { status: 401 });
    }

    const tokens = await completeProxyRefreshGrant({
      apiResourceId,
      clientId,
      refreshToken: validation.data.refresh_token,
      scope: validation.data.scope,
      authMethod,
      clientSecret,
      auditContext: { requestContext, clientSecretInBody, clientIdProvided },
    });

    return Response.json(tokens);
  } catch (error) {
    return toResponse(error);
  }
}
