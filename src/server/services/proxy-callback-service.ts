import { URLSearchParams } from "node:url";

import { DomainError } from "@/server/errors";
import {
  getProxyAuthTransaction,
  markProxyTransactionCompleted,
  storeProxyTokenExchange,
  createProxyAuthorizationCode,
  deleteProxyAuthTransaction,
  requestProviderTokens,
} from "@/server/services/proxy-service";
import { sanitizeProviderError, sanitizeProviderErrorDescription } from "@/server/services/proxy-utils";

type ProxyCallbackParams = {
  apiResourceId: string;
  state: string;
  code?: string;
  providerError?: string;
  providerErrorDescription?: string;
  transactionCookie?: string;
  origin: string;
};

type ProxyCallbackResult = {
  redirectTo: string;
  clearTransactionCookie: boolean;
};

const buildCallbackUrl = (origin: string, apiResourceId: string) =>
  new URL(`/r/${apiResourceId}/oidc/proxy/callback`, origin).toString();

export const handleProxyCallback = async (params: ProxyCallbackParams): Promise<ProxyCallbackResult> => {
  if (!params.transactionCookie || params.transactionCookie !== params.state) {
    throw new DomainError("Invalid or missing proxy transaction", { status: 400, code: "invalid_request" });
  }

  const transaction = await getProxyAuthTransaction(params.state);
  if (!transaction) {
    throw new DomainError("Proxy transaction not found", { status: 400, code: "invalid_request" });
  }

  if (transaction.apiResourceId !== params.apiResourceId) {
    throw new DomainError("Proxy transaction does not match issuer", { status: 400, code: "invalid_request" });
  }

  if (transaction.expiresAt < new Date()) {
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
    await markProxyTransactionCompleted(transaction.id);
    return { redirectTo: redirectUrl.toString(), clearTransactionCookie: true };
  }

  if (!params.code) {
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
      const providerError = sanitizeProviderError(typeof result.json?.error === "string" ? result.json.error : undefined);
      const description = sanitizeProviderErrorDescription(
        typeof result.json?.error_description === "string" ? result.json.error_description : undefined,
      );
      redirectUrl.searchParams.set("error", providerError);
      if (description) {
        redirectUrl.searchParams.set("error_description", description);
      }
      if (transaction.appState) {
        redirectUrl.searchParams.set("state", transaction.appState);
      }
      await markProxyTransactionCompleted(transaction.id);
      return { redirectTo: redirectUrl.toString(), clearTransactionCookie: true };
    }

    if (!result.json || typeof result.json !== "object") {
      throw new DomainError("Provider token response missing", { status: 502 });
    }

    const exchange = await storeProxyTokenExchange({
      tenantId: transaction.tenantId,
      apiResourceId: transaction.apiResourceId,
      clientId: transaction.clientId,
      transactionId: transaction.id,
      providerResponse: result.json,
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
