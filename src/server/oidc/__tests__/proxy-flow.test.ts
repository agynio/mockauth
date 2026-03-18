import { randomUUID } from "node:crypto";
import { vi, describe, it, beforeAll, afterAll, expect } from "vitest";

import { $Enums, AuditLogEventType } from "@/generated/prisma/client";

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
import { PROXY_TRANSACTION_COOKIE } from "@/server/oidc/proxy/constants";
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

  beforeAll(async () => {
    const tenant = await prisma.tenant.findFirstOrThrow({ where: { id: DEFAULT_TENANT_ID }, include: { mockUsers: true } });
    tenantId = tenant.id;
    apiResourceId = tenant.defaultApiResourceId!;
    const user = tenant.mockUsers[0];
    sessionToken = await createSession(tenant.id, user.id, {
      strategy: $Enums.LoginStrategy.USERNAME,
      subject: user.username,
    });

    const proxyClient = await prisma.client.create({
      data: {
        tenantId,
        clientId: `proxy_${randomUUID().slice(0, 8)}`,
        name: "Proxy QA Client",
        clientType: "PUBLIC",
        tokenEndpointAuthMethod: "none",
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

  it("brokers authorization_code and refresh_token flows", async () => {
    const codeVerifier = "verifier-ABCDEFGHIJKLMNOPQRSTUVWXYZ123456";
    const codeChallenge = computeS256Challenge(codeVerifier);

    const authorize = await handleAuthorize(
      {
        apiResourceId,
        clientId: proxyClientClientId,
        redirectUri: "https://proxy-client.test/callback",
        responseType: "code",
        scope: "openid profile",
        state: "app-state",
        codeChallenge,
        codeChallengeMethod: "S256",
        sessionToken,
        loginHint: "demo@example.com",
      },
      "https://mockauth.test",
      `https://mockauth.test/r/${apiResourceId}/oidc/authorize?client_id=${proxyClientClientId}`,
    );

    expect(authorize.type).toBe("redirect");
    expect(authorize.cookies).toBeDefined();
    const proxyCookie = authorize.cookies?.find((cookie) => cookie.name === PROXY_TRANSACTION_COOKIE);
    expect(proxyCookie?.value).toBeDefined();

    const providerAuthorizeUrl = new URL(authorize.redirectTo);
    expect(providerAuthorizeUrl.origin).toBe("https://upstream.example.com");
    expect(providerAuthorizeUrl.searchParams.get("client_id")).toBe("up-client");
    const transactionId = providerAuthorizeUrl.searchParams.get("state");
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

    const callback = await handleProxyCallback({
      apiResourceId,
      state: transactionId!,
      code: "provider-code-123",
      transactionCookie: proxyCookie?.value,
      origin: "https://mockauth.test",
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

    const traceLogs = await prisma.auditLog.findMany({
      where: { tenantId, traceId: transactionId ?? undefined },
      select: { eventType: true },
    });
    const traceEventTypes = traceLogs.map((log) => log.eventType);
    expect(traceEventTypes).toEqual(
      expect.arrayContaining([
        AuditLogEventType.AUTHORIZE_RECEIVED,
        AuditLogEventType.PROXY_REDIRECT_OUT,
        AuditLogEventType.PROXY_CALLBACK_SUCCESS,
        AuditLogEventType.PROXY_CODE_ISSUED,
        AuditLogEventType.TOKEN_AUTHCODE_RECEIVED,
        AuditLogEventType.TOKEN_AUTHCODE_COMPLETED,
      ]),
    );
    const refreshLogs = await prisma.auditLog.findMany({
      where: { tenantId, clientId: proxyClientId, eventType: AuditLogEventType.TOKEN_REFRESH_COMPLETED },
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

  it("brokers flows when the upstream provider requires client_secret_post", async () => {
    const localSecret = "local-post-secret";
    const upstreamSecret = "upstream-post-secret";

    const proxyClient = await prisma.client.create({
      data: {
        tenantId,
        clientId: `proxy_post_${randomUUID().slice(0, 8)}`,
        name: "Proxy Post Client",
        clientType: "CONFIDENTIAL",
        tokenEndpointAuthMethod: "client_secret_post",
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

    const authorize = await handleAuthorize(
      {
        apiResourceId,
        clientId: proxyClient.clientId,
        redirectUri: "https://proxy-client-post.test/callback",
        responseType: "code",
        scope: "openid profile",
        state: "post-app-state",
        codeChallenge,
        codeChallengeMethod: "S256",
        sessionToken,
      },
      "https://mockauth.test",
      `https://mockauth.test/r/${apiResourceId}/oidc/authorize?client_id=${proxyClient.clientId}`,
    );

    expect(authorize.type).toBe("redirect");
    const proxyCookie = authorize.cookies?.find((cookie) => cookie.name === PROXY_TRANSACTION_COOKIE);
    expect(proxyCookie?.value).toBeDefined();

    const providerAuthorizeUrl = new URL(authorize.redirectTo);
    expect(providerAuthorizeUrl.origin).toBe("https://upstream-post.example.com");
    expect(providerAuthorizeUrl.searchParams.get("client_id")).toBe("post-up-client");
    const transactionId = providerAuthorizeUrl.searchParams.get("state");
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

    const callback = await handleProxyCallback({
      apiResourceId,
      state: transactionId!,
      code: "provider-code-post",
      transactionCookie: proxyCookie?.value,
      origin: "https://mockauth.test",
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
