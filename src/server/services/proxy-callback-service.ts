import { URLSearchParams } from "node:url";

import { DomainError } from "@/server/errors";
import { emitAuditEvent, recordSecurityViolation } from "@/server/services/audit-service";
import {
  buildProxyCallbackErrorDetails,
  buildProxyCallbackSuccessDetails,
  buildProxyCodeIssuedDetails,
  toTokenResponsePayload,
} from "@/server/services/audit-event";
import { getApiResourceWithTenant } from "@/server/services/api-resource-service";
import {
  getProxyAuthTransaction,
  markProxyTransactionCompleted,
  storeProxyTokenExchange,
  createProxyAuthorizationCode,
  deleteProxyAuthTransaction,
  requestProviderTokens,
} from "@/server/services/proxy-service";
import { sanitizeProviderError, sanitizeProviderErrorDescription } from "@/server/services/proxy-utils";
import type { RequestContext } from "@/server/utils/request-context";

type ProxyCallbackParams = {
  apiResourceId: string;
  state: string;
  code?: string;
  providerError?: string;
  providerErrorDescription?: string;
  transactionCookie?: string;
  origin: string;
  requestContext?: RequestContext;
};

type ProxyCallbackResult = {
  redirectTo: string;
  clearTransactionCookie: boolean;
};

const buildCallbackUrl = (origin: string, apiResourceId: string) =>
  new URL(`/r/${apiResourceId}/oidc/proxy/callback`, origin).toString();

export const handleProxyCallback = async (params: ProxyCallbackParams): Promise<ProxyCallbackResult> => {
  if (!params.transactionCookie || params.transactionCookie !== params.state) {
    const tenantContext = await getApiResourceWithTenant(params.apiResourceId).catch(() => null);
    if (tenantContext) {
      void recordSecurityViolation({
        tenantId: tenantContext.tenant.id,
        traceId: params.state,
        reason: "state_mismatch",
        expectedState: params.transactionCookie ?? null,
        receivedState: params.state,
        requestContext: params.requestContext ?? null,
      });
    }
    throw new DomainError("Invalid or missing proxy transaction", { status: 400, code: "invalid_request" });
  }

  const transaction = await getProxyAuthTransaction(params.state);
  if (!transaction) {
    const tenantContext = await getApiResourceWithTenant(params.apiResourceId).catch(() => null);
    if (tenantContext) {
      void recordSecurityViolation({
        tenantId: tenantContext.tenant.id,
        traceId: params.state,
        reason: "state_not_found",
        receivedState: params.state,
        requestContext: params.requestContext ?? null,
      });
    }
    throw new DomainError("Proxy transaction not found", { status: 400, code: "invalid_request" });
  }

  if (transaction.apiResourceId !== params.apiResourceId) {
    void recordSecurityViolation({
      tenantId: transaction.tenantId,
      clientId: transaction.clientId,
      traceId: transaction.id,
      reason: "state_resource_mismatch",
      expectedApiResourceId: transaction.apiResourceId,
      receivedApiResourceId: params.apiResourceId,
      requestContext: params.requestContext ?? null,
    });
    throw new DomainError("Proxy transaction does not match issuer", { status: 400, code: "invalid_request" });
  }

  if (transaction.expiresAt < new Date()) {
    void emitAuditEvent({
      tenantId: transaction.tenantId,
      clientId: transaction.clientId,
      traceId: transaction.id,
      actorId: null,
      eventType: "PROXY_CALLBACK_ERROR",
      severity: "WARN",
      message: "Proxy transaction expired",
      details: buildProxyCallbackErrorDetails({
        error: "transaction_expired",
        providerType: transaction.client.proxyConfig?.providerType,
        code: params.code ?? undefined,
      }),
      requestContext: params.requestContext ?? null,
    });
    await markProxyTransactionCompleted(transaction.id);
    throw new DomainError("Proxy transaction has expired", { status: 400, code: "invalid_request" });
  }

  const config = transaction.client.proxyConfig;
  if (!config) {
    await markProxyTransactionCompleted(transaction.id);
    throw new DomainError("Proxy configuration missing", { status: 500 });
  }

  const redirectUrl = new URL(transaction.redirectUri);

  if (params.providerError) {
    const error = sanitizeProviderError(params.providerError);
    redirectUrl.searchParams.set("error", error);
    const description = sanitizeProviderErrorDescription(params.providerErrorDescription);
    if (description) {
      redirectUrl.searchParams.set("error_description", description);
    }
    if (transaction.appState) {
      redirectUrl.searchParams.set("state", transaction.appState);
    }
    void emitAuditEvent({
      tenantId: transaction.tenantId,
      clientId: transaction.clientId,
      traceId: transaction.id,
      actorId: null,
      eventType: "PROXY_CALLBACK_ERROR",
      severity: "WARN",
      message: "Proxy provider returned error",
      details: buildProxyCallbackErrorDetails({
        error,
        errorDescription: description,
        providerType: config.providerType,
        code: params.code ?? undefined,
        rawError: params.providerError ?? undefined,
        rawErrorDescription: params.providerErrorDescription ?? undefined,
      }),
      requestContext: params.requestContext ?? null,
    });
    await markProxyTransactionCompleted(transaction.id);
    return { redirectTo: redirectUrl.toString(), clearTransactionCookie: true };
  }

  if (!params.code) {
    void emitAuditEvent({
      tenantId: transaction.tenantId,
      clientId: transaction.clientId,
      traceId: transaction.id,
      actorId: null,
      eventType: "PROXY_CALLBACK_ERROR",
      severity: "WARN",
      message: "Proxy provider did not return a code",
      details: buildProxyCallbackErrorDetails({
        error: "missing_code",
        providerType: config.providerType,
        code: params.code ?? undefined,
      }),
      requestContext: params.requestContext ?? null,
    });
    await markProxyTransactionCompleted(transaction.id);
    throw new DomainError("Authorization code not provided by provider", { status: 400, code: "invalid_request" });
  }

  const callbackUrl = buildCallbackUrl(params.origin, params.apiResourceId);
  const tokenRequest = new URLSearchParams();
  tokenRequest.set("grant_type", "authorization_code");
  tokenRequest.set("code", params.code);
  tokenRequest.set("redirect_uri", callbackUrl);
  tokenRequest.set("client_id", config.upstreamClientId);

  if (transaction.providerPkceEnabled && transaction.providerCodeVerifier) {
    tokenRequest.set("code_verifier", transaction.providerCodeVerifier);
  }

  try {
    const result = await requestProviderTokens(config, tokenRequest);

    if (!result.ok) {
      const rawError = typeof result.json?.error === "string" ? result.json.error : undefined;
      const rawDescription =
        typeof result.json?.error_description === "string" ? result.json.error_description : undefined;
      const providerError = sanitizeProviderError(rawError);
      const description = sanitizeProviderErrorDescription(rawDescription);
      redirectUrl.searchParams.set("error", providerError);
      if (description) {
        redirectUrl.searchParams.set("error_description", description);
      }
      if (transaction.appState) {
        redirectUrl.searchParams.set("state", transaction.appState);
      }
      void emitAuditEvent({
        tenantId: transaction.tenantId,
        clientId: transaction.clientId,
        traceId: transaction.id,
        actorId: null,
        eventType: "PROXY_CALLBACK_ERROR",
        severity: "WARN",
        message: "Proxy provider token exchange failed",
        details: buildProxyCallbackErrorDetails({
          error: providerError,
          errorDescription: description,
          providerType: config.providerType,
          code: params.code ?? undefined,
          rawError,
          rawErrorDescription: rawDescription,
        }),
        requestContext: params.requestContext ?? null,
      });
      await markProxyTransactionCompleted(transaction.id);
      return { redirectTo: redirectUrl.toString(), clearTransactionCookie: true };
    }

    if (!result.json || typeof result.json !== "object" || Array.isArray(result.json)) {
      void emitAuditEvent({
        tenantId: transaction.tenantId,
        clientId: transaction.clientId,
        traceId: transaction.id,
        actorId: null,
        eventType: "PROXY_CALLBACK_ERROR",
        severity: "WARN",
        message: "Proxy provider token response missing",
        details: buildProxyCallbackErrorDetails({
          error: "missing_token_response",
          providerType: config.providerType,
          code: params.code ?? undefined,
        }),
        requestContext: params.requestContext ?? null,
      });
      throw new DomainError("Provider token response missing", { status: 502 });
    }

    const providerPayload = toTokenResponsePayload(result.json);

    const exchange = await storeProxyTokenExchange({
      tenantId: transaction.tenantId,
      apiResourceId: transaction.apiResourceId,
      clientId: transaction.clientId,
      transactionId: transaction.id,
      providerResponse: result.json,
    });

    void emitAuditEvent({
      tenantId: transaction.tenantId,
      clientId: transaction.clientId,
      traceId: transaction.id,
      actorId: null,
      eventType: "PROXY_CALLBACK_SUCCESS",
      severity: "INFO",
      message: "Proxy provider callback succeeded",
      details: buildProxyCallbackSuccessDetails({
        providerType: config.providerType,
        providerResponse: providerPayload,
      }),
      requestContext: params.requestContext ?? null,
    });

    const proxyCode = await createProxyAuthorizationCode({
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

    void emitAuditEvent({
      tenantId: transaction.tenantId,
      clientId: transaction.clientId,
      traceId: transaction.id,
      actorId: null,
      eventType: "PROXY_CODE_ISSUED",
      severity: "INFO",
      message: "Proxy authorization code issued",
      details: buildProxyCodeIssuedDetails({
        scope: transaction.appScope,
        redirectUri: transaction.redirectUri,
      }),
      requestContext: params.requestContext ?? null,
    });

    await markProxyTransactionCompleted(transaction.id);

    const successRedirect = new URL(transaction.redirectUri);
    successRedirect.searchParams.set("code", proxyCode);
    if (transaction.appState) {
      successRedirect.searchParams.set("state", transaction.appState);
    }

    return { redirectTo: successRedirect.toString(), clearTransactionCookie: true };
  } catch (error) {
    await deleteProxyAuthTransaction(transaction.id);
    if (error instanceof DomainError) {
      throw error;
    }
    throw new DomainError("Failed to complete proxy callback", { status: 502 });
  }
};
