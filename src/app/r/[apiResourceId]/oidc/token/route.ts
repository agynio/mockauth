import type { NextRequest } from "next/server";
import { z } from "zod";

import { toResponse } from "@/server/errors";
import { consumeAuthorizationCode } from "@/server/services/authorization-code-service";
import { issueTokensFromCode } from "@/server/services/token-service";
import { resolveOrigin, resolveUrl } from "@/server/http/origin";
import type { ApiResourceRouteContext } from "@/types/api-resource-route";
import {
  isProxyCode,
  completeProxyAuthorizationCodeGrant,
  completeProxyRefreshGrant,
} from "@/server/services/proxy-token-service";
import { createSecurityViolationReporter } from "@/server/services/security-violation";
import { getRequestContextFromRequest } from "@/server/utils/request-context";
import type { ProxyFlowRequestDetails } from "@/server/services/audit-event";
import { collectHeaders, collectParams } from "@/server/utils/diagnostics";

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
  const formEntries = Array.from((await request.clone().formData()).entries(), ([key, value]) => [
    key,
    typeof value === "string" ? value : value.name,
  ]) as Array<[string, string]>;
  const entries: Record<string, string> = Object.fromEntries(formEntries);
  const params = collectParams(formEntries);
  const validation = tokenSchema.safeParse(entries);

  if (!validation.success) {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }

  const requestHeaders = collectHeaders(request.headers);
  const requestContentType = request.headers.get("content-type");
  const requestUrl = resolveUrl(request).toString();
  const rawBody = await request.clone().text();
  const requestDetails: ProxyFlowRequestDetails = {
    url: requestUrl,
    headers: requestHeaders,
    contentType: requestContentType,
    body: rawBody,
  };
  const basic = parseBasicAuth(request.headers.get("authorization"));
  const clientId = basic?.clientId ?? entries.client_id ?? null;
  const clientSecret = basic?.clientSecret ?? entries.client_secret ?? null;
  const requestContext = getRequestContextFromRequest(request);
  const origin = resolveOrigin(request);

  try {
    const { apiResourceId } = await context.params;
    const clientSecretInBody = Boolean(validation.data.client_secret);
    const clientIdProvided = Boolean(clientId);
    const includeAuthHeader = Boolean(basic);

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
          auditContext: {
            requestContext,
            origin,
            clientSecretInBody,
            clientIdProvided,
            includeAuthHeader,
            requestParams: params,
            request: requestDetails,
          },
        });

        return Response.json(tokens);
      }

      const codeRecord = await consumeAuthorizationCode(validation.data.code);
      const reportViolation = createSecurityViolationReporter({
        tenantId: codeRecord.tenantId,
        clientId: codeRecord.clientId,
        traceId: codeRecord.traceId ?? null,
        severity: "ERROR" as const,
        authMethod,
        clientSecretInBody,
        requestContext,
      });
      if (codeRecord.apiResourceId !== apiResourceId) {
        await reportViolation("issuer_mismatch", {
          expectedApiResourceId: codeRecord.apiResourceId,
          receivedApiResourceId: apiResourceId,
        });
        return Response.json({ error: "invalid_grant" }, { status: 400 });
      }

      if (clientId && codeRecord.client.clientId !== clientId) {
        await reportViolation("client_mismatch", {
          expectedClientId: codeRecord.client.clientId,
          receivedClientId: clientId,
        });
        return Response.json({ error: "invalid_client" }, { status: 401 });
      }

      if (codeRecord.client.tokenEndpointAuthMethod !== authMethod) {
        await reportViolation("auth_method_mismatch", {
          expectedAuthMethod: codeRecord.client.tokenEndpointAuthMethod,
          receivedAuthMethod: authMethod,
        });
        return Response.json({ error: "invalid_client" }, { status: 401 });
      }

      const tokens = await issueTokensFromCode({
        code: codeRecord,
        codeVerifier: validation.data.code_verifier,
        redirectUri: validation.data.redirect_uri,
        clientSecret,
        origin,
        authorizationCode: validation.data.code,
        auditContext: {
          requestContext,
          authMethod,
          clientSecretInBody,
          clientIdProvided,
          clientId: clientId ?? undefined,
          includeAuthHeader,
        },
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
      auditContext: {
        requestContext,
        clientSecretInBody,
        clientIdProvided,
        includeAuthHeader,
        requestParams: params,
        request: requestDetails,
      },
    });

    return Response.json(tokens);
  } catch (error) {
    return toResponse(error);
  }
}
