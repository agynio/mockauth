import { randomUUID } from "node:crypto";
import { vi, describe, it, beforeAll, afterAll, expect } from "vitest";

import { $Enums } from "@/generated/prisma/client";

import { prisma } from "@/server/db/client";
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
          },
        },
      },
    });

    proxyClientId = proxyClient.id;
    proxyClientClientId = proxyClient.clientId;
    upstreamTokenResponses = [];
  });

  afterAll(async () => {
    await clearSession(tenantId, sessionToken);
    if (proxyClientId) {
      await prisma.client.delete({ where: { id: proxyClientId } }).catch(() => undefined);
    }
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

    expect(fetchMock).toHaveBeenCalledTimes(2);
    fetchMock.mockRestore();
  });
});
