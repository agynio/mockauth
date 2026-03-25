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
        const result = await requestProviderTokens(config, body);

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

        const recordedRequest = result.request;
        const recordedParams = toParams(recordedRequest.body);
        const recordedAuthorization = recordedRequest.headers.authorization;

        if (usesAuthorization) {
          expect(recordedAuthorization).toBe("[redacted]");
        } else {
          expect(recordedAuthorization).toBeUndefined();
        }

        expect(recordedParams.get("client_id")).toBe("up-client");
        if (method === "client_secret_post") {
          expect(recordedParams.get("client_secret")).toBe("[redacted]");
        } else {
          expect(recordedParams.has("client_secret")).toBe(false);
        }
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

  it("trims upstream credentials for client_secret_basic", async () => {
    const fetchSpy = mockFetch();
    const config = buildConfig({
      upstreamClientId: "  up-client  \n",
      upstreamClientSecretEncrypted: encrypt("  secret  \n"),
      upstreamTokenEndpointAuthMethod: "client_secret_basic",
    });

    const result = await requestProviderTokens(config, grantBodies.authorization_code);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, init] = fetchSpy.mock.calls[0];
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const encoded = headers.authorization?.replace(/^Basic\s+/u, "") ?? "";
    const decoded = Buffer.from(encoded, "base64").toString("utf8");
    expect(decoded).toBe("up-client:secret");

    const params = toParams(init?.body);
    expect(params.get("client_id")).toBe("up-client");

    const recordedParams = toParams(result.request.body);
    expect(recordedParams.get("client_id")).toBe("up-client");
  });

  it("trims upstream credentials for client_secret_post", async () => {
    const fetchSpy = mockFetch();
    const config = buildConfig({
      upstreamClientId: " \tup-client  \n",
      upstreamClientSecretEncrypted: encrypt(" \nsecret\t"),
      upstreamTokenEndpointAuthMethod: "client_secret_post",
    });

    const result = await requestProviderTokens(config, grantBodies.refresh_token);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, init] = fetchSpy.mock.calls[0];
    const params = toParams(init?.body);

    expect(params.get("client_id")).toBe("up-client");
    expect(params.get("client_secret")).toBe("secret");

    const recordedParams = toParams(result.request.body);
    expect(recordedParams.get("client_id")).toBe("up-client");
    expect(recordedParams.get("client_secret")).toBe("[redacted]");
  });
});
