import { randomUUID } from "node:crypto";
import { vi, describe, it, beforeAll, afterAll, expect } from "vitest";
import type { NextRequest } from "next/server";


import { POST as handleTokenPost } from "@/app/r/[apiResourceId]/oidc/token/route";
import { prisma } from "@/server/db/client";
import { encrypt } from "@/server/crypto/key-vault";
import { hashSecret } from "@/server/crypto/hash";
import { computeS256Challenge } from "@/server/crypto/pkce";
import { handleAuthorize } from "@/server/services/authorize-service";
import { handleProxyCallback } from "@/server/services/proxy-callback-service";
import {
  completeProxyAuthorizationCodeGrant,
  completeProxyRefreshGrant,
} from "@/server/services/proxy-token-service";
import { createSession, clearSession } from "@/server/services/mock-session-service";
import { PROXY_TRANSACTION_COOKIE, buildProxyCallbackUrl } from "@/server/oidc/proxy/constants";
import { DEFAULT_CLIENT_AUTH_STRATEGIES } from "@/server/oidc/auth-strategy";

const DEFAULT_TENANT_ID = "tenant_qa";

const cleanupClientIds: string[] = [];

describe("Proxy client OAuth flow", () => {
  let tenantId: string;
  let apiResourceId: string;
  let proxyClientId: string;
  let proxyClientClientId: string;
  let sessionToken: string;
  let upstreamTokenResponses: Array<Record<string, unknown>>;

  const buildCallbackContext = (options: {
    state: string;
    code?: string;
    error?: string;
    errorDescription?: string;
    sessionState?: string;
  }) => {
    const callbackUrl = new URL(`https://mockauth.test/r/${apiResourceId}/oidc/proxy/callback`);
    callbackUrl.searchParams.set("state", options.state);
    if (options.code) {
      callbackUrl.searchParams.set("code", options.code);
    }
    if (options.error) {
      callbackUrl.searchParams.set("error", options.error);
    }
    if (options.errorDescription) {
      callbackUrl.searchParams.set("error_description", options.errorDescription);
    }
    if (options.sessionState) {
      callbackUrl.searchParams.set("session_state", options.sessionState);
    }
    return {
      callbackUrl,
      callbackRequest: {
        url: callbackUrl.toString(),
        headers: { "user-agent": "vitest" },
        contentType: null,
        body: null,
      },
      callbackParams: Object.fromEntries(callbackUrl.searchParams.entries()),
    };
  };

  const startProxyAuthorization = async (options: {
    clientId: string;
    redirectUri: string;
    codeChallenge: string;
    state: string;
    scope?: string;
    nonce?: string;
    prompt?: string;
    loginHint?: string;
  }) => {
    const authorize = await handleAuthorize(
      {
        apiResourceId,
        clientId: options.clientId,
        redirectUri: options.redirectUri,
        responseType: "code",
        scope: options.scope ?? "openid profile",
        state: options.state,
        nonce: options.nonce,
        codeChallenge: options.codeChallenge,
        codeChallengeMethod: "S256",
        prompt: options.prompt,
        sessionToken,
        loginHint: options.loginHint,
      },
      "https://mockauth.test",
      `https://mockauth.test/r/${apiResourceId}/oidc/authorize?client_id=${options.clientId}`,
    );

    const proxyCookie = authorize.cookies?.find((cookie) => cookie.name === PROXY_TRANSACTION_COOKIE);
    const providerAuthorizeUrl = new URL(authorize.redirectTo);
    const transactionId = providerAuthorizeUrl.searchParams.get("state");
    return { authorize, proxyCookie, transactionId };
  };

  const asNextRequest = (request: Request) => request as unknown as NextRequest;

  beforeAll(async () => {
    const tenant = await prisma.tenant.findFirstOrThrow({ where: { id: DEFAULT_TENANT_ID }, include: { mockUsers: true } });
    tenantId = tenant.id;
    apiResourceId = tenant.defaultApiResourceId!;
    const user = tenant.mockUsers[0];
    sessionToken = await createSession(tenant.id, user.id, {
      strategy: "USERNAME",
      subject: user.username,
    });

    const proxyClient = await prisma.client.create({
      data: {
        tenantId,
        clientId: `proxy_${randomUUID().slice(0, 8)}`,
        name: "Proxy QA Client",
        tokenEndpointAuthMethods: ["none"],
        oauthClientMode: "proxy",
        allowedScopes: ["openid", "profile"],
        authStrategies: DEFAULT_CLIENT_AUTH_STRATEGIES,
        redirectUris: {
          create: [{ uri: "https://proxy-client.test/callback", type: "EXACT" }],
        },
        proxyConfig: {
          create: {
            providerType: "oidc",
            authorizationEndpoint: "https://upstream.example.com/oauth2/authorize",
            tokenEndpoint: "https://upstream.example.com/oauth2/token",
            upstreamClientId: "up-client",
            defaultScopes: ["openid", "email"],
            scopeMapping: { profile: ["profile.read"] },
            pkceSupported: true,
            oidcEnabled: true,
            promptPassthroughEnabled: true,
            loginHintPassthroughEnabled: true,
            passthroughTokenResponse: false,
            upstreamTokenEndpointAuthMethod: "none",
          },
        },
      },
    });

    proxyClientId = proxyClient.id;
    proxyClientClientId = proxyClient.clientId;
    cleanupClientIds.push(proxyClient.id);
    upstreamTokenResponses = [];
  });

  afterAll(async () => {
    await clearSession(tenantId, sessionToken);
    await Promise.all(
      cleanupClientIds.map((id) => prisma.client.delete({ where: { id } }).catch(() => undefined)),
    );
  });

  it("logs provider redirect details with PKCE", async () => {
    const codeVerifier = "verifier-redirect-ABCDEFGHIJKLMNOPQRSTUVWXYZ012345";
    const codeChallenge = computeS256Challenge(codeVerifier);

    const { authorize, transactionId } = await startProxyAuthorization({
      clientId: proxyClientClientId,
      redirectUri: "https://proxy-client.test/callback",
      codeChallenge,
      state: "redirect-pkce-state",
      nonce: "redirect-nonce",
      prompt: "login",
      loginHint: "pkce@example.com",
    });

    const redirectLog = await prisma.auditLog.findFirst({
      where: {
        tenantId,
        traceId: transactionId ?? undefined,
        eventType: "PROXY_REDIRECT_OUT",
      },
      orderBy: { createdAt: "desc" },
    });

    expect(redirectLog).not.toBeNull();
    expect(redirectLog).toMatchObject({
      clientId: proxyClientId,
      traceId: transactionId,
      eventType: "PROXY_REDIRECT_OUT",
    });

    const redirectDetails = redirectLog?.details as {
      providerAuthorizationUrl?: string;
      providerAuthorizationParams?: Record<string, string | string[]>;
    };
    expect(redirectDetails.providerAuthorizationUrl).toBe(authorize.redirectTo);

    const authorizationParams = redirectDetails.providerAuthorizationParams ?? {};
    expect(authorizationParams).toMatchObject({
      client_id: "up-client",
      redirect_uri: buildProxyCallbackUrl("https://mockauth.test", apiResourceId),
      response_type: "code",
      scope: "openid profile.read",
      state: transactionId,
      nonce: "redirect-nonce",
      prompt: "login",
      login_hint: "pkce@example.com",
      code_challenge_method: "S256",
    });
    expect(authorizationParams.code_challenge).toEqual(expect.any(String));
  });

  it("logs provider redirect details without PKCE", async () => {
    const noPkceClient = await prisma.client.create({
      data: {
        tenantId,
        clientId: `proxy_nopkce_${randomUUID().slice(0, 8)}`,
        name: "Proxy No PKCE Client",
        tokenEndpointAuthMethods: ["none"],
        oauthClientMode: "proxy",
        allowedScopes: ["openid", "profile"],
        authStrategies: DEFAULT_CLIENT_AUTH_STRATEGIES,
        redirectUris: {
          create: [{ uri: "https://proxy-nopkce.test/callback", type: "EXACT" }],
        },
        proxyConfig: {
          create: {
            providerType: "oidc",
            authorizationEndpoint: "https://upstream-nopkce.example.com/oauth2/authorize",
            tokenEndpoint: "https://upstream-nopkce.example.com/oauth2/token",
            upstreamClientId: "up-nopkce-client",
            defaultScopes: ["openid", "email"],
            scopeMapping: { profile: ["profile.read"] },
            pkceSupported: false,
            oidcEnabled: true,
            promptPassthroughEnabled: true,
            loginHintPassthroughEnabled: true,
            passthroughTokenResponse: false,
            upstreamTokenEndpointAuthMethod: "none",
          },
        },
      },
    });

    cleanupClientIds.push(noPkceClient.id);

    const codeVerifier = "verifier-nopkce-ABCDEFGHIJKLMNOPQRSTUVWXYZ012345";
    const codeChallenge = computeS256Challenge(codeVerifier);

    const { authorize, transactionId } = await startProxyAuthorization({
      clientId: noPkceClient.clientId,
      redirectUri: "https://proxy-nopkce.test/callback",
      codeChallenge,
      state: "redirect-nopkce-state",
      prompt: "consent",
      loginHint: "nopkce@example.com",
    });

    const redirectLog = await prisma.auditLog.findFirst({
      where: {
        tenantId,
        traceId: transactionId ?? undefined,
        eventType: "PROXY_REDIRECT_OUT",
      },
      orderBy: { createdAt: "desc" },
    });

    expect(redirectLog).not.toBeNull();
    expect(redirectLog).toMatchObject({
      clientId: noPkceClient.id,
      traceId: transactionId,
      eventType: "PROXY_REDIRECT_OUT",
    });

    const redirectDetails = redirectLog?.details as {
      providerAuthorizationUrl?: string;
      providerAuthorizationParams?: Record<string, string | string[]>;
    };
    expect(redirectDetails.providerAuthorizationUrl).toBe(authorize.redirectTo);

    const authorizationParams = redirectDetails.providerAuthorizationParams ?? {};
    expect(authorizationParams).toMatchObject({
      client_id: "up-nopkce-client",
      redirect_uri: buildProxyCallbackUrl("https://mockauth.test", apiResourceId),
      response_type: "code",
      scope: "openid profile.read",
      state: transactionId,
      prompt: "consent",
      login_hint: "nopkce@example.com",
    });
    expect(authorizationParams).not.toHaveProperty("code_challenge");
    expect(authorizationParams).not.toHaveProperty("code_challenge_method");
  });

  it("brokers authorization_code and refresh_token flows", async () => {
    const codeVerifier = "verifier-ABCDEFGHIJKLMNOPQRSTUVWXYZ123456";
    const codeChallenge = computeS256Challenge(codeVerifier);

    const { authorize, proxyCookie, transactionId } = await startProxyAuthorization({
      clientId: proxyClientClientId,
      redirectUri: "https://proxy-client.test/callback",
      codeChallenge,
      state: "app-state",
      loginHint: "demo@example.com",
    });

    expect(authorize.type).toBe("redirect");
    expect(authorize.cookies).toBeDefined();
    expect(proxyCookie?.value).toBeDefined();

    const providerAuthorizeUrl = new URL(authorize.redirectTo);
    expect(providerAuthorizeUrl.origin).toBe("https://upstream.example.com");
    expect(providerAuthorizeUrl.searchParams.get("client_id")).toBe("up-client");
    expect(transactionId).toBe(proxyCookie?.value);
    expect(providerAuthorizeUrl.searchParams.get("login_hint")).toBe("demo@example.com");
    expect(providerAuthorizeUrl.searchParams.get("scope")).toContain("profile.read");

    const fetchMock = vi.spyOn(global, "fetch").mockImplementation(async () => {
      const payload = upstreamTokenResponses.shift();
      if (!payload) {
        return new Response(JSON.stringify({ error: "unexpected" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    upstreamTokenResponses.push({
      access_token: "up-access-token",
      token_type: "Bearer",
      expires_in: 3600,
      refresh_token: "up-refresh-token",
      id_token: "up-id-token",
      scope: "openid profile",
    });

    const callbackContext = buildCallbackContext({
      state: transactionId!,
      code: "provider-code-123",
      sessionState: "session-1",
    });
    const callback = await handleProxyCallback({
      apiResourceId,
      state: transactionId!,
      code: "provider-code-123",
      transactionCookie: proxyCookie?.value,
      origin: "https://mockauth.test",
      callbackRequest: callbackContext.callbackRequest,
      callbackParams: callbackContext.callbackParams,
    });

    expect(callback.redirectTo).toContain("https://proxy-client.test/callback");
    expect(callback.clearTransactionCookie).toBe(true);
    const appRedirect = new URL(callback.redirectTo);
    const appCode = appRedirect.searchParams.get("code");
    expect(appCode).toBeTruthy();

    const tokens = await completeProxyAuthorizationCodeGrant({
      apiResourceId,
      code: appCode!,
      redirectUri: "https://proxy-client.test/callback",
      codeVerifier,
      authMethod: "none",
      clientIdFromRequest: null,
      clientSecret: null,
    });

    expect(tokens).toMatchObject({
      access_token: "up-access-token",
      token_type: "Bearer",
      expires_in: 3600,
      refresh_token: "up-refresh-token",
      id_token: "up-id-token",
      scope: "openid profile",
    });

    upstreamTokenResponses.push({
      access_token: "up-access-token-2",
      token_type: "Bearer",
      expires_in: 1800,
      refresh_token: "up-refresh-token-2",
      scope: "openid profile",
    });

    const refreshed = await completeProxyRefreshGrant({
      apiResourceId,
      clientId: proxyClientClientId,
      refreshToken: "up-refresh-token",
      scope: "openid profile",
      authMethod: "none",
      clientSecret: null,
    });

    expect(refreshed).toMatchObject({
      access_token: "up-access-token-2",
      refresh_token: "up-refresh-token-2",
      token_type: "Bearer",
      expires_in: 1800,
    });
    const receivedLog = await prisma.auditLog.findFirst({
      where: { tenantId, traceId: transactionId ?? undefined, eventType: "TOKEN_AUTHCODE_RECEIVED" },
      orderBy: { createdAt: "desc" },
    });
    expect(receivedLog).not.toBeNull();
    const receivedDetails = receivedLog?.details as Record<string, unknown> & {
      upstreamCall?: boolean;
      authorizationCode?: string;
    };
    expect(receivedDetails.upstreamCall).toBe(false);
    expect(receivedDetails.authorizationCode).toBe(appCode);

    const completedLog = await prisma.auditLog.findFirst({
      where: {
        tenantId,
        traceId: transactionId ?? undefined,
        eventType: "TOKEN_AUTHCODE_COMPLETED",
        severity: "INFO",
      },
      orderBy: { createdAt: "desc" },
    });
    expect(completedLog).not.toBeNull();
    const completedDetails = completedLog?.details as Record<string, unknown> & {
      upstreamCall?: boolean;
      providerResponse?: Record<string, unknown>;
    };
    expect(completedDetails.upstreamCall).toBe(false);
    expect(completedDetails).toMatchObject({
      access_token: "up-access-token",
      refresh_token: "up-refresh-token",
      token_type: "Bearer",
      scope: "openid profile",
      id_token: "up-id-token",
      expires_in: 3600,
    });
    expect(completedDetails.providerResponse).toMatchObject({
      access_token: "up-access-token",
      refresh_token: "up-refresh-token",
      token_type: "Bearer",
      scope: "openid profile",
      id_token: "up-id-token",
      expires_in: 3600,
    });

    const traceLogs = await prisma.auditLog.findMany({
      where: { tenantId, traceId: transactionId ?? undefined },
      select: { eventType: true },
    });
    const traceEventTypes = traceLogs.map((log) => log.eventType);
    expect(traceEventTypes).toEqual(
      expect.arrayContaining([
        "AUTHORIZE_RECEIVED",
        "PROXY_REDIRECT_OUT",
        "PROXY_CALLBACK_SUCCESS",
        "PROXY_CODE_ISSUED",
        "TOKEN_AUTHCODE_RECEIVED",
        "TOKEN_AUTHCODE_COMPLETED",
      ]),
    );
    const refreshLogs = await prisma.auditLog.findMany({
      where: { tenantId, clientId: proxyClientId, eventType: "TOKEN_REFRESH_COMPLETED" },
    });
    expect(refreshLogs.length).toBeGreaterThan(0);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, firstInit] = fetchMock.mock.calls[0];
    const firstHeaders = (firstInit?.headers ?? {}) as Record<string, string>;
    expect(firstHeaders.authorization).toBeUndefined();
    const firstParams = new URLSearchParams(firstInit?.body as URLSearchParams);
    expect(firstParams.get("client_id")).toBe("up-client");
    expect(firstParams.has("client_secret")).toBe(false);

    const [, secondInit] = fetchMock.mock.calls[1];
    const secondHeaders = (secondInit?.headers ?? {}) as Record<string, string>;
    expect(secondHeaders.authorization).toBeUndefined();
    const secondParams = new URLSearchParams(secondInit?.body as URLSearchParams);
    expect(secondParams.get("client_id")).toBe("up-client");
    expect(secondParams.has("client_secret")).toBe(false);

    fetchMock.mockRestore();
  });

  it("logs diagnostics when callback is missing a code", async () => {
    const codeChallenge = computeS256Challenge("verifier-missing-code-ABCDEFGHIJKLMNOPQRSTUVWXYZ");

    const { proxyCookie, transactionId } = await startProxyAuthorization({
      clientId: proxyClientClientId,
      redirectUri: "https://proxy-client.test/callback",
      codeChallenge,
      state: "missing-code-state",
    });

    const callbackContext = buildCallbackContext({
      state: transactionId!,
      sessionState: "session-missing",
    });

    await expect(
      handleProxyCallback({
        apiResourceId,
        state: transactionId!,
        transactionCookie: proxyCookie?.value,
        origin: "https://mockauth.test",
        callbackRequest: callbackContext.callbackRequest,
        callbackParams: callbackContext.callbackParams,
      }),
    ).rejects.toMatchObject({ options: { code: "invalid_request" } });

    const callbackErrorLog = await prisma.auditLog.findFirst({
      where: {
        tenantId,
        traceId: transactionId ?? undefined,
        eventType: "PROXY_CALLBACK_ERROR",
        message: "Proxy provider did not return a code",
      },
      orderBy: { createdAt: "desc" },
    });

    expect(callbackErrorLog).not.toBeNull();
    const diagnosticDetails = (callbackErrorLog?.details as { diagnostics?: Record<string, unknown> }).diagnostics;
    expect(diagnosticDetails).toMatchObject({
      stage: "callback",
      request: {
        url: callbackContext.callbackUrl.toString(),
        headers: { "user-agent": "vitest" },
      },
      params: {
        state: transactionId,
        session_state: "session-missing",
      },
      response: { status: null },
    });

    const codeLog = await prisma.auditLog.findFirst({
      where: {
        tenantId,
        traceId: transactionId ?? undefined,
        eventType: "PROXY_CODE_ISSUED",
      },
      orderBy: { createdAt: "desc" },
    });

    expect(codeLog?.details).toMatchObject({
      issued: false,
      authorizationCode: null,
    });
  });

  it("logs diagnostics when provider returns an error", async () => {
    const codeChallenge = computeS256Challenge("verifier-provider-error-ABCDEFGHIJKLMNOPQRSTUVWXYZ");

    const { proxyCookie, transactionId } = await startProxyAuthorization({
      clientId: proxyClientClientId,
      redirectUri: "https://proxy-client.test/callback",
      codeChallenge,
      state: "provider-error-state",
    });

    const callbackContext = buildCallbackContext({
      state: transactionId!,
      error: "access_denied",
      errorDescription: "User denied",
      sessionState: "session-error",
    });

    const callback = await handleProxyCallback({
      apiResourceId,
      state: transactionId!,
      providerError: "access_denied",
      providerErrorDescription: "User denied",
      transactionCookie: proxyCookie?.value,
      origin: "https://mockauth.test",
      callbackRequest: callbackContext.callbackRequest,
      callbackParams: callbackContext.callbackParams,
    });

    expect(callback.redirectTo).toContain("error=access_denied");

    const callbackErrorLog = await prisma.auditLog.findFirst({
      where: {
        tenantId,
        traceId: transactionId ?? undefined,
        eventType: "PROXY_CALLBACK_ERROR",
        message: "Proxy provider returned error",
      },
      orderBy: { createdAt: "desc" },
    });

    expect(callbackErrorLog).not.toBeNull();
    const diagnosticDetails = (callbackErrorLog?.details as { diagnostics?: Record<string, unknown> }).diagnostics;
    expect(diagnosticDetails).toMatchObject({
      stage: "callback",
      params: {
        state: transactionId,
        error: "access_denied",
        error_description: "User denied",
        session_state: "session-error",
      },
    });

    const codeLog = await prisma.auditLog.findFirst({
      where: {
        tenantId,
        traceId: transactionId ?? undefined,
        eventType: "PROXY_CODE_ISSUED",
      },
      orderBy: { createdAt: "desc" },
    });

    expect(codeLog?.details).toMatchObject({
      issued: false,
      authorizationCode: null,
    });
  });

  it("records an ERROR audit entry when the proxy callback exchange fails", async () => {
    const codeVerifier = "verifier-error-callback-ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const codeChallenge = computeS256Challenge(codeVerifier);

    const { authorize, proxyCookie, transactionId } = await startProxyAuthorization({
      clientId: proxyClientClientId,
      redirectUri: "https://proxy-client.test/callback",
      codeChallenge,
      state: "app-state-error",
    });

    const providerAuthorizeUrl = new URL(authorize.redirectTo);
    expect(proxyCookie?.value).toBeDefined();
    expect(transactionId).toBe(proxyCookie?.value);

    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "invalid_grant", error_description: "Bad code" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const callbackContext = buildCallbackContext({
      state: transactionId!,
      code: "provider-bad-code",
      sessionState: "session-2",
    });
    const callback = await handleProxyCallback({
      apiResourceId,
      state: transactionId!,
      code: "provider-bad-code",
      transactionCookie: proxyCookie?.value,
      origin: "https://mockauth.test",
      callbackRequest: callbackContext.callbackRequest,
      callbackParams: callbackContext.callbackParams,
    });

    expect(callback.redirectTo).toContain("error=invalid_grant");

    const auditLog = await prisma.auditLog.findFirst({
      where: { tenantId, traceId: transactionId ?? undefined, eventType: "PROXY_CALLBACK_ERROR" },
      orderBy: { createdAt: "desc" },
    });

    expect(auditLog).not.toBeNull();
    expect(auditLog).toMatchObject({
      severity: "ERROR",
      clientId: proxyClientId,
      traceId: transactionId,
      eventType: "PROXY_CALLBACK_ERROR",
    });
    const callbackDetails = auditLog?.details as Record<string, unknown>;
    expect(callbackDetails).toMatchObject({
      tokenEndpointHost: "upstream.example.com",
      authMethod: "none",
      includeAuthHeader: false,
      includeClientSecretInBody: false,
      client_id: "up-client",
      redirect_uri: buildProxyCallbackUrl("https://mockauth.test", apiResourceId),
      grant_type: "authorization_code",
      code_verifier_present: true,
    });

    const exchangeDetails = (callbackDetails as { diagnostics?: Record<string, unknown> }).diagnostics;
    expect(exchangeDetails).toMatchObject({
      stage: "callback",
      request: {
        url: "https://upstream.example.com/oauth2/token",
        headers: expect.objectContaining({
          accept: "application/json",
          "content-type": "application/x-www-form-urlencoded",
        }),
      },
      response: {
        status: 400,
        headers: expect.objectContaining({ "content-type": "application/json" }),
        body: JSON.stringify({ error: "invalid_grant", error_description: "Bad code" }),
      },
      params: expect.objectContaining({
        state: transactionId,
        code: "provider-bad-code",
      }),
    });

    const codeLog = await prisma.auditLog.findFirst({
      where: {
        tenantId,
        traceId: transactionId ?? undefined,
        eventType: "PROXY_CODE_ISSUED",
      },
      orderBy: { createdAt: "desc" },
    });

    expect(codeLog?.details).toMatchObject({
      issued: false,
      authorizationCode: null,
    });

    fetchMock.mockRestore();
  });

  it("records TOKEN_AUTHCODE_COMPLETED error details for proxy token failures", async () => {
    const codeVerifier = "verifier-error-token-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    const codeChallenge = computeS256Challenge(codeVerifier);

    const { authorize, proxyCookie, transactionId } = await startProxyAuthorization({
      clientId: proxyClientClientId,
      redirectUri: "https://proxy-client.test/callback",
      codeChallenge,
      state: "app-state-token-error",
    });

    const providerAuthorizeUrl = new URL(authorize.redirectTo);
    expect(proxyCookie?.value).toBeDefined();
    expect(transactionId).toBe(proxyCookie?.value);

    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: "up-access-error",
          token_type: "Bearer",
          expires_in: 3600,
          refresh_token: "up-refresh-error",
          scope: "openid profile",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    const callbackContext = buildCallbackContext({
      state: transactionId!,
      code: "provider-good-code",
    });
    const callback = await handleProxyCallback({
      apiResourceId,
      state: transactionId!,
      code: "provider-good-code",
      transactionCookie: proxyCookie?.value,
      origin: "https://mockauth.test",
      callbackRequest: callbackContext.callbackRequest,
      callbackParams: callbackContext.callbackParams,
    });

    const appRedirect = new URL(callback.redirectTo);
    const appCode = appRedirect.searchParams.get("code");
    expect(appCode).toBeTruthy();

    const requestBody = new URLSearchParams({
      grant_type: "authorization_code",
      code: appCode!,
      redirect_uri: "https://proxy-client.test/wrong-callback",
      code_verifier: codeVerifier,
      client_id: proxyClientClientId,
    });
    const tokenResponse = await handleTokenPost(
      asNextRequest(
        new Request(`https://mockauth.test/r/${apiResourceId}/oidc/token`, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: requestBody.toString(),
        }),
      ),
      { params: Promise.resolve({ apiResourceId }) },
    );

    expect(tokenResponse.status).toBe(400);

    const auditLog = await prisma.auditLog.findFirst({
      where: {
        tenantId,
        traceId: transactionId ?? undefined,
        eventType: "TOKEN_AUTHCODE_COMPLETED",
        severity: "ERROR",
      },
      orderBy: { createdAt: "desc" },
    });

    expect(auditLog).not.toBeNull();
    expect(auditLog).toMatchObject({
      severity: "ERROR",
      clientId: proxyClientId,
      traceId: transactionId,
      eventType: "TOKEN_AUTHCODE_COMPLETED",
    });
    const tokenErrorDetails = auditLog?.details as Record<string, unknown>;
    expect(tokenErrorDetails).toMatchObject({
      upstreamCall: false,
      tokenEndpointHost: "upstream.example.com",
      authMethod: "none",
      includeAuthHeader: false,
      includeClientSecretInBody: false,
      client_id: "up-client",
      redirect_uri: buildProxyCallbackUrl("https://mockauth.test", apiResourceId),
      grant_type: "authorization_code",
      code_verifier_present: true,
    });

    const requestLogs = await prisma.auditLog.findMany({
      where: {
        tenantId,
        eventType: "TOKEN_AUTHCODE_RECEIVED",
      },
      orderBy: { createdAt: "desc" },
    });
    const requestLog = requestLogs.find((log) => {
      const details = log.details as { diagnostics?: { request?: { body?: unknown } } };
      return details.diagnostics?.request?.body === requestBody.toString();
    });

    expect(requestLog).toBeDefined();
    const requestDetails = (requestLog?.details as { diagnostics?: Record<string, unknown> }).diagnostics;
    expect((requestLog?.details as { upstreamCall?: boolean }).upstreamCall).toBe(false);
    expect(requestDetails).toMatchObject({
      stage: "token",
      request: {
        url: `https://mockauth.test/r/${apiResourceId}/oidc/token`,
        headers: expect.objectContaining({ "content-type": "application/x-www-form-urlencoded" }),
        body: requestBody.toString(),
      },
      params: expect.objectContaining({
        code: appCode!,
        redirect_uri: "https://proxy-client.test/wrong-callback",
      }),
    });

    const codeLog = await prisma.auditLog.findFirst({
      where: {
        tenantId,
        traceId: transactionId ?? undefined,
        eventType: "PROXY_CODE_ISSUED",
      },
      orderBy: { createdAt: "desc" },
    });

    expect(codeLog?.details).toMatchObject({
      issued: true,
      authorizationCode: appCode,
    });

    fetchMock.mockRestore();
  });

  it("logs token diagnostics for bad client credentials", async () => {
    const localSecret = "local-basic-secret";
    const proxyClient = await prisma.client.create({
      data: {
        tenantId,
        clientId: `proxy_basic_${randomUUID().slice(0, 8)}`,
        name: "Proxy Basic Client",
        tokenEndpointAuthMethods: ["client_secret_basic"],
        clientSecretHash: await hashSecret(localSecret),
        clientSecretEncrypted: encrypt(localSecret),
        oauthClientMode: "proxy",
        allowedScopes: ["openid", "profile"],
        authStrategies: DEFAULT_CLIENT_AUTH_STRATEGIES,
        redirectUris: {
          create: [{ uri: "https://proxy-basic.test/callback", type: "EXACT" }],
        },
        proxyConfig: {
          create: {
            providerType: "oidc",
            authorizationEndpoint: "https://upstream-basic.example.com/oauth2/authorize",
            tokenEndpoint: "https://upstream-basic.example.com/oauth2/token",
            upstreamClientId: "basic-up-client",
            defaultScopes: ["openid", "email"],
            scopeMapping: { profile: ["profile.read"] },
            pkceSupported: true,
            oidcEnabled: true,
            promptPassthroughEnabled: true,
            loginHintPassthroughEnabled: true,
            passthroughTokenResponse: false,
            upstreamTokenEndpointAuthMethod: "none",
          },
        },
      },
    });

    cleanupClientIds.push(proxyClient.id);

    const codeVerifier = "verifier-basic-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    const codeChallenge = computeS256Challenge(codeVerifier);

    const { proxyCookie, transactionId } = await startProxyAuthorization({
      clientId: proxyClient.clientId,
      redirectUri: "https://proxy-basic.test/callback",
      codeChallenge,
      state: "basic-auth-state",
    });

    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: "up-basic-access",
          token_type: "Bearer",
          expires_in: 3600,
          refresh_token: "up-basic-refresh",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    const callbackContext = buildCallbackContext({
      state: transactionId!,
      code: "provider-basic-code",
    });
    const callback = await handleProxyCallback({
      apiResourceId,
      state: transactionId!,
      code: "provider-basic-code",
      transactionCookie: proxyCookie?.value,
      origin: "https://mockauth.test",
      callbackRequest: callbackContext.callbackRequest,
      callbackParams: callbackContext.callbackParams,
    });

    const appCode = new URL(callback.redirectTo).searchParams.get("code");
    expect(appCode).toBeTruthy();

    const badSecret = "bad-secret";
    const basicAuth = Buffer.from(`${proxyClient.clientId}:${badSecret}`).toString("base64");
    const requestBody = new URLSearchParams({
      grant_type: "authorization_code",
      code: appCode!,
      redirect_uri: "https://proxy-basic.test/callback",
      code_verifier: codeVerifier,
    });

    const tokenResponse = await handleTokenPost(
      asNextRequest(
        new Request(`https://mockauth.test/r/${apiResourceId}/oidc/token`, {
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            authorization: `Basic ${basicAuth}`,
          },
          body: requestBody.toString(),
        }),
      ),
      { params: Promise.resolve({ apiResourceId }) },
    );

    expect(tokenResponse.status).toBe(401);

    const requestLogs = await prisma.auditLog.findMany({
      where: {
        tenantId,
        eventType: "TOKEN_AUTHCODE_RECEIVED",
      },
      orderBy: { createdAt: "desc" },
    });
    const requestLog = requestLogs.find((log) => {
      const details = log.details as { diagnostics?: { request?: { body?: unknown } } };
      return details.diagnostics?.request?.body === requestBody.toString();
    });

    expect(requestLog).toBeDefined();
    const requestDetails = (requestLog?.details as { diagnostics?: Record<string, unknown> }).diagnostics;
    expect((requestLog?.details as { upstreamCall?: boolean }).upstreamCall).toBe(false);
    expect(requestDetails).toMatchObject({
      stage: "token",
      request: {
        url: `https://mockauth.test/r/${apiResourceId}/oidc/token`,
        headers: expect.objectContaining({ authorization: `Basic ${basicAuth}` }),
        body: requestBody.toString(),
      },
      params: expect.objectContaining({
        code: appCode!,
        redirect_uri: "https://proxy-basic.test/callback",
      }),
    });

    const codeLog = await prisma.auditLog.findFirst({
      where: {
        tenantId,
        traceId: transactionId ?? undefined,
        eventType: "PROXY_CODE_ISSUED",
      },
      orderBy: { createdAt: "desc" },
    });

    expect(codeLog?.details).toMatchObject({
      issued: true,
      authorizationCode: appCode,
    });

    fetchMock.mockRestore();
  });

  it("logs token diagnostics for PKCE mismatches", async () => {
    const codeVerifier = "verifier-pkce-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    const codeChallenge = computeS256Challenge(codeVerifier);

    const { proxyCookie, transactionId } = await startProxyAuthorization({
      clientId: proxyClientClientId,
      redirectUri: "https://proxy-client.test/callback",
      codeChallenge,
      state: "pkce-mismatch-state",
    });

    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: "up-pkce-access",
          token_type: "Bearer",
          expires_in: 3600,
          refresh_token: "up-pkce-refresh",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    const callbackContext = buildCallbackContext({
      state: transactionId!,
      code: "provider-pkce-code",
    });
    const callback = await handleProxyCallback({
      apiResourceId,
      state: transactionId!,
      code: "provider-pkce-code",
      transactionCookie: proxyCookie?.value,
      origin: "https://mockauth.test",
      callbackRequest: callbackContext.callbackRequest,
      callbackParams: callbackContext.callbackParams,
    });

    const appCode = new URL(callback.redirectTo).searchParams.get("code");
    expect(appCode).toBeTruthy();

    const requestBody = new URLSearchParams({
      grant_type: "authorization_code",
      code: appCode!,
      redirect_uri: "https://proxy-client.test/callback",
      code_verifier: "bad-verifier-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
      client_id: proxyClientClientId,
    });

    const tokenResponse = await handleTokenPost(
      asNextRequest(
        new Request(`https://mockauth.test/r/${apiResourceId}/oidc/token`, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: requestBody.toString(),
        }),
      ),
      { params: Promise.resolve({ apiResourceId }) },
    );

    expect(tokenResponse.status).toBe(400);

    const requestLog = await prisma.auditLog.findFirst({
      where: {
        tenantId,
        eventType: "TOKEN_AUTHCODE_RECEIVED",
      },
      orderBy: { createdAt: "desc" },
    });

    expect(requestLog).not.toBeNull();
    const requestDetails = (requestLog?.details as { diagnostics?: Record<string, unknown> }).diagnostics;
    expect((requestLog?.details as { upstreamCall?: boolean }).upstreamCall).toBe(false);
    expect(requestDetails).toMatchObject({
      stage: "token",
      params: expect.objectContaining({
        code: appCode!,
        code_verifier: "bad-verifier-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
      }),
    });

    const codeLog = await prisma.auditLog.findFirst({
      where: {
        tenantId,
        traceId: transactionId ?? undefined,
        eventType: "PROXY_CODE_ISSUED",
      },
      orderBy: { createdAt: "desc" },
    });

    expect(codeLog?.details).toMatchObject({
      issued: true,
      authorizationCode: appCode,
    });

    fetchMock.mockRestore();
  });

  it.each([400, 401, 403, 500])("logs refresh diagnostics for upstream %s", async (status) => {
    const errorPayload = {
      error: `refresh_error_${status}`,
      error_description: `Refresh failed ${status}`,
    };
    const errorBody = JSON.stringify(errorPayload);
    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(errorBody, {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const requestBody = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: `bad-refresh-${status}`,
      scope: "openid profile",
      client_id: proxyClientClientId,
    });

    const tokenResponse = await handleTokenPost(
      asNextRequest(
        new Request(`https://mockauth.test/r/${apiResourceId}/oidc/token`, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: requestBody.toString(),
        }),
      ),
      { params: Promise.resolve({ apiResourceId }) },
    );

    expect(tokenResponse.status).toBe(400);

    const requestLog = await prisma.auditLog.findFirst({
      where: {
        tenantId,
        eventType: "TOKEN_REFRESH_RECEIVED",
      },
      orderBy: { createdAt: "desc" },
    });

    expect(requestLog).not.toBeNull();
    const requestDetails = (requestLog?.details as { diagnostics?: Record<string, unknown> }).diagnostics;
    expect(requestDetails).toMatchObject({
      stage: "token",
      request: {
        url: `https://mockauth.test/r/${apiResourceId}/oidc/token`,
        headers: expect.objectContaining({ "content-type": "application/x-www-form-urlencoded" }),
        body: requestBody.toString(),
      },
      params: expect.objectContaining({
        grant_type: "refresh_token",
        refresh_token: `bad-refresh-${status}`,
      }),
    });

    const exchangeLog = await prisma.auditLog.findFirst({
      where: {
        tenantId,
        eventType: "PROXY_CALLBACK_ERROR",
        message: "Proxy provider refresh failed",
      },
      orderBy: { createdAt: "desc" },
    });

    expect(exchangeLog).not.toBeNull();
    const exchangeDetails = (exchangeLog?.details as { diagnostics?: Record<string, unknown> }).diagnostics;
    expect(exchangeDetails).toMatchObject({
      stage: "token",
      request: {
        url: "https://upstream.example.com/oauth2/token",
        headers: expect.objectContaining({
          accept: "application/json",
          "content-type": "application/x-www-form-urlencoded",
        }),
      },
      response: {
        status,
        headers: expect.objectContaining({ "content-type": "application/json" }),
        body: errorBody,
      },
    });

    fetchMock.mockRestore();
  });

  it("brokers flows when the upstream provider requires client_secret_post", async () => {
    const localSecret = "local-post-secret";
    const upstreamSecret = "upstream-post-secret";

    const proxyClient = await prisma.client.create({
      data: {
        tenantId,
        clientId: `proxy_post_${randomUUID().slice(0, 8)}`,
        name: "Proxy Post Client",
        tokenEndpointAuthMethods: ["client_secret_post"],
        clientSecretHash: await hashSecret(localSecret),
        clientSecretEncrypted: encrypt(localSecret),
        oauthClientMode: "proxy",
        allowedScopes: ["openid", "profile"],
        authStrategies: DEFAULT_CLIENT_AUTH_STRATEGIES,
        redirectUris: {
          create: [{ uri: "https://proxy-client-post.test/callback", type: "EXACT" }],
        },
        proxyConfig: {
          create: {
            providerType: "oidc",
            authorizationEndpoint: "https://upstream-post.example.com/oauth2/authorize",
            tokenEndpoint: "https://upstream-post.example.com/oauth2/token",
            upstreamClientId: "post-up-client",
            upstreamClientSecretEncrypted: encrypt(upstreamSecret),
            defaultScopes: ["openid", "email"],
            scopeMapping: { profile: ["profile.read"] },
            pkceSupported: true,
            oidcEnabled: true,
            promptPassthroughEnabled: true,
            loginHintPassthroughEnabled: true,
            passthroughTokenResponse: false,
            upstreamTokenEndpointAuthMethod: "client_secret_post",
          },
        },
      },
    });

    cleanupClientIds.push(proxyClient.id);

    const codeVerifier = "verifier-POST-ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const codeChallenge = computeS256Challenge(codeVerifier);

    const { authorize, proxyCookie, transactionId } = await startProxyAuthorization({
      clientId: proxyClient.clientId,
      redirectUri: "https://proxy-client-post.test/callback",
      codeChallenge,
      state: "post-app-state",
    });

    expect(authorize.type).toBe("redirect");
    expect(proxyCookie?.value).toBeDefined();

    const providerAuthorizeUrl = new URL(authorize.redirectTo);
    expect(providerAuthorizeUrl.origin).toBe("https://upstream-post.example.com");
    expect(providerAuthorizeUrl.searchParams.get("client_id")).toBe("post-up-client");
    expect(transactionId).toBe(proxyCookie?.value);

    const responses: Array<Record<string, unknown>> = [
      {
        access_token: "post-up-access",
        token_type: "Bearer",
        expires_in: 3600,
        refresh_token: "post-up-refresh",
        id_token: "post-up-id-token",
        scope: "openid profile",
      },
      {
        access_token: "post-up-access-2",
        token_type: "Bearer",
        expires_in: 1800,
        refresh_token: "post-up-refresh-2",
        scope: "openid profile",
      },
    ];

    const parseParams = (body: unknown) => {
      if (!body) {
        return new URLSearchParams();
      }
      if (typeof body === "string") {
        return new URLSearchParams(body);
      }
      if (body instanceof URLSearchParams) {
        return new URLSearchParams(body);
      }
      return new URLSearchParams(body as string);
    };

    const seenRequests: Array<{ headers: Record<string, string>; params: URLSearchParams }> = [];

    const fetchMock = vi.spyOn(global, "fetch").mockImplementation(async (_url, init) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      const params = parseParams(init?.body);
      seenRequests.push({ headers, params });

      if (headers.authorization) {
        return new Response(JSON.stringify({ error: "unexpected_authorization" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (!params.get("client_secret")) {
        return new Response(JSON.stringify({ error: "invalid_client" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }

      const payload = responses.shift();
      if (!payload) {
        return new Response(JSON.stringify({ error: "unexpected" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const callbackContext = buildCallbackContext({
      state: transactionId!,
      code: "provider-code-post",
    });
    const callback = await handleProxyCallback({
      apiResourceId,
      state: transactionId!,
      code: "provider-code-post",
      transactionCookie: proxyCookie?.value,
      origin: "https://mockauth.test",
      callbackRequest: callbackContext.callbackRequest,
      callbackParams: callbackContext.callbackParams,
    });

    expect(callback.redirectTo).toContain("https://proxy-client-post.test/callback");
    const appRedirect = new URL(callback.redirectTo);
    const appCode = appRedirect.searchParams.get("code");
    expect(appCode).toBeTruthy();

    const tokens = await completeProxyAuthorizationCodeGrant({
      apiResourceId,
      code: appCode!,
      redirectUri: "https://proxy-client-post.test/callback",
      codeVerifier,
      authMethod: "client_secret_post",
      clientIdFromRequest: null,
      clientSecret: localSecret,
    });

    expect(tokens).toMatchObject({
      access_token: "post-up-access",
      refresh_token: "post-up-refresh",
      token_type: "Bearer",
    });

    const refreshed = await completeProxyRefreshGrant({
      apiResourceId,
      clientId: proxyClient.clientId,
      refreshToken: "post-up-refresh",
      scope: "openid profile",
      authMethod: "client_secret_post",
      clientSecret: localSecret,
    });

    expect(refreshed).toMatchObject({
      access_token: "post-up-access-2",
      refresh_token: "post-up-refresh-2",
      token_type: "Bearer",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(seenRequests).toHaveLength(2);
    const [authRequest, refreshRequest] = seenRequests;
    expect(authRequest.headers.authorization).toBeUndefined();
    expect(refreshRequest.headers.authorization).toBeUndefined();
    expect(authRequest.params.get("client_id")).toBe("post-up-client");
    expect(refreshRequest.params.get("client_id")).toBe("post-up-client");
    expect(authRequest.params.get("client_secret")).toBe(upstreamSecret);
    expect(refreshRequest.params.get("client_secret")).toBe(upstreamSecret);
    expect(authRequest.params.get("grant_type")).toBe("authorization_code");
    expect(authRequest.params.get("code")).toBe("provider-code-post");
    expect(authRequest.params.get("redirect_uri")).toBe(
      `https://mockauth.test/r/${apiResourceId}/oidc/proxy/callback`,
    );
    expect(authRequest.params.get("code_verifier")).toBeTruthy();
    expect(refreshRequest.params.get("grant_type")).toBe("refresh_token");
    expect(refreshRequest.params.get("refresh_token")).toBe("post-up-refresh");
    fetchMock.mockRestore();
  });
});
