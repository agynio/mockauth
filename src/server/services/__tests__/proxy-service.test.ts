import { afterEach, describe, expect, it, vi } from "vitest";

import type { ProxyProviderConfig } from "@/generated/prisma/client";

import { requestProviderTokens } from "@/server/services/proxy-service";
import { encrypt } from "@/server/crypto/key-vault";

const buildConfig = (
  overrides: Partial<ProxyProviderConfig> = {},
): ProxyProviderConfig => ({
  id: "proxy-config",
  clientId: "client",
  providerType: "oidc",
  authorizationEndpoint: "https://example.com/oauth2/authorize",
  tokenEndpoint: "https://example.com/oauth2/token",
  userinfoEndpoint: null,
  jwksUri: null,
  upstreamClientId: "up-client",
  upstreamClientSecretEncrypted: encrypt("secret"),
  upstreamTokenEndpointAuthMethod: "client_secret_basic",
  defaultScopes: [],
  scopeMapping: null,
  pkceSupported: false,
  oidcEnabled: false,
  promptPassthroughEnabled: false,
  loginHintPassthroughEnabled: false,
  passthroughTokenResponse: false,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const mockFetch = () =>
  vi.spyOn(global, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ access_token: "token" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );

describe("requestProviderTokens", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const toParams = (body: unknown) => {
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

  const expectCommonHeaders = (headers: Record<string, string>, hasAuthorization: boolean) => {
    expect(headers["content-type"]).toBe("application/x-www-form-urlencoded");
    expect(headers.accept).toBe("application/json");
    if (hasAuthorization) {
      expect(headers.authorization).toMatch(/^Basic\s+/);
    } else {
      expect(headers.authorization).toBeUndefined();
    }
  };

  const expectGrantParams = (grantType: "authorization_code" | "refresh_token", params: URLSearchParams) => {
    expect(params.get("client_id")).toBe("up-client");
    expect(params.get("grant_type")).toBe(grantType);
    if (grantType === "authorization_code") {
      expect(params.get("code")).toBe("provider-code");
      expect(params.get("redirect_uri")).toBe("https://mockauth.test/callback");
      expect(params.get("code_verifier")).toBe("provider-code-verifier");
    } else {
      expect(params.get("refresh_token")).toBe("provider-refresh");
      expect(params.get("scope")).toBe("openid profile");
    }
  };

  const grantBodies: Record<"authorization_code" | "refresh_token", URLSearchParams> = {
    authorization_code: new URLSearchParams([
      ["grant_type", "authorization_code"],
      ["code", "provider-code"],
      ["redirect_uri", "https://mockauth.test/callback"],
      ["code_verifier", "provider-code-verifier"],
    ]),
    refresh_token: new URLSearchParams([
      ["grant_type", "refresh_token"],
      ["refresh_token", "provider-refresh"],
      ["scope", "openid profile"],
    ]),
  };

  const authMethods: Array<"client_secret_basic" | "client_secret_post" | "none"> = [
    "client_secret_basic",
    "client_secret_post",
    "none",
  ];

  describe.each(Object.entries(grantBodies))("%s grant type", (grantType, body) => {
    it.each(authMethods)(
      "applies %s authentication rules",
      async (method) => {
        const fetchSpy = mockFetch();
        const config = buildConfig({
          upstreamTokenEndpointAuthMethod: method,
          upstreamClientSecretEncrypted: method === "none" ? null : encrypt("secret"),
        });
        const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});

        await requestProviderTokens(config, body);

        expect(fetchSpy).toHaveBeenCalledTimes(1);
        const [, init] = fetchSpy.mock.calls[0];
        const headers = (init?.headers ?? {}) as Record<string, string>;
        const params = toParams(init?.body);

        const usesAuthorization = method === "client_secret_basic";
        expectCommonHeaders(headers, usesAuthorization);
        expectGrantParams(grantType as "authorization_code" | "refresh_token", params);

        if (method === "client_secret_basic") {
          expect(params.has("client_secret")).toBe(false);
        } else if (method === "client_secret_post") {
          expect(params.get("client_secret")).toBe("secret");
        } else {
          expect(params.has("client_secret")).toBe(false);
        }

        expect(debugSpy).toHaveBeenCalledTimes(1);
        expect(debugSpy).toHaveBeenCalledWith("proxy_provider_token_request", {
          provider: config.providerType,
          authMethod: config.upstreamTokenEndpointAuthMethod ?? "client_secret_basic",
          includeAuthHeader: usesAuthorization,
          includeClientSecretInBody: params.has("client_secret"),
          hasClientId: params.has("client_id"),
          grantType: params.get("grant_type"),
          includesRedirectUri: params.has("redirect_uri"),
          includesCode: params.has("code"),
          includesRefreshToken: params.has("refresh_token"),
        });
      },
    );
  });

  it("throws when a secret-backed method is selected without a secret", async () => {
    mockFetch();
    const config = buildConfig({ upstreamClientSecretEncrypted: null });

    await expect(requestProviderTokens(config, grantBodies.authorization_code)).rejects.toThrow(
      "client_secret_basic",
    );

    const postConfig = buildConfig({
      upstreamTokenEndpointAuthMethod: "client_secret_post",
      upstreamClientSecretEncrypted: null,
    });

    await expect(requestProviderTokens(postConfig, grantBodies.refresh_token)).rejects.toThrow("client_secret_post");
  });
});
