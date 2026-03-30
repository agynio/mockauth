import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { DomainError, toResponse } from "@/server/errors";
import { PREAUTHORIZED_PICKER_COOKIE, buildPreauthorizedPickerCookiePath } from "@/server/oidc/preauthorized/constants";
import { mapAppScopesToProvider } from "@/server/oidc/proxy/scope-mapping";
import { emitAuditEvent } from "@/server/services/audit-service";
import { buildProxyCodeIssuedDetails } from "@/server/services/audit-event";
import {
  markPickerTransactionConsumed,
  requirePickerTransaction,
} from "@/server/services/preauthorized-picker-service";
import { resolvePreauthorizedIdentityTokens } from "@/server/services/preauthorized-identity-service";
import { createProxyAuthorizationCode, storeProxyTokenExchange } from "@/server/services/proxy-service";
import { buildRequestContext } from "@/server/utils/request-context";

const selectionSchema = z.object({
  identity_id: z.string().min(1),
});

export async function POST(request: NextRequest, context: { params: Promise<{ apiResourceId: string }> }) {
  const formData = await request.formData();
  const parsed = selectionSchema.safeParse({
    identity_id: formData.get("identity_id"),
  });

  if (!parsed.success) {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }

  const { apiResourceId } = await context.params;
  const transactionId = request.cookies.get(PREAUTHORIZED_PICKER_COOKIE)?.value;
  if (!transactionId) {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }

  const transaction = await requirePickerTransaction(transactionId);
  if (transaction.apiResourceId !== apiResourceId) {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }

  let codeLogged = false;
  const recordCodeIssued = async (issued: boolean, authorizationCode?: string | null) => {
    if (codeLogged) {
      return;
    }
    codeLogged = true;
    await emitAuditEvent({
      tenantId: transaction.tenantId,
      clientId: transaction.clientId,
      traceId: transaction.id,
      actorId: null,
      eventType: "PREAUTHORIZED_CODE_ISSUED",
      severity: "INFO",
      message: issued ? "Preauthorized code issued" : "Preauthorized code not issued",
      details: buildProxyCodeIssuedDetails({
        scope: transaction.appScope,
        redirectUri: transaction.redirectUri,
        issued,
        authorizationCode,
      }),
      requestContext: buildRequestContext(request.headers, (request as { ip?: string | null }).ip ?? null),
    });
  };

  try {
    const { identity, providerResponse } = await resolvePreauthorizedIdentityTokens({
      tenantId: transaction.tenantId,
      clientId: transaction.clientId,
      identityId: parsed.data.identity_id,
    });

    const proxyConfig = identity.client.proxyConfig;
    if (!proxyConfig) {
      throw new DomainError("Proxy configuration missing", { status: 500 });
    }

    const providerScope = mapAppScopesToProvider(transaction.appScope, proxyConfig);
    const exchange = await storeProxyTokenExchange({
      tenantId: transaction.tenantId,
      apiResourceId: transaction.apiResourceId,
      clientId: transaction.clientId,
      transactionId: null,
      providerScope,
      providerResponse,
    });

    const code = await createProxyAuthorizationCode({
      tenantId: transaction.tenantId,
      apiResourceId: transaction.apiResourceId,
      clientId: transaction.clientId,
      redirectUri: transaction.redirectUri,
      scope: transaction.appScope,
      nonce: transaction.appNonce,
      state: transaction.appState,
      codeChallenge: transaction.appCodeChallenge,
      codeChallengeMethod: transaction.appCodeChallengeMethod,
      tokenExchangeId: exchange.id,
    });

    await recordCodeIssued(true, code);
    await markPickerTransactionConsumed(transaction.id);

    const redirectUrl = new URL(transaction.redirectUri);
    redirectUrl.searchParams.set("code", code);
    if (transaction.appState) {
      redirectUrl.searchParams.set("state", transaction.appState);
    }

    const response = NextResponse.redirect(redirectUrl.toString(), { status: 302 });
    response.cookies.set({
      name: PREAUTHORIZED_PICKER_COOKIE,
      value: "",
      path: buildPreauthorizedPickerCookiePath(apiResourceId),
      httpOnly: true,
      sameSite: "lax",
      secure: request.nextUrl.protocol === "https:",
      maxAge: 0,
    });
    return response;
  } catch (error) {
    if (!codeLogged && transaction) {
      await recordCodeIssued(false);
    }
    return toResponse(error);
  }
}
