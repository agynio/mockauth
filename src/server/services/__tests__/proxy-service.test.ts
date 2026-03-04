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

  it("uses HTTP Basic when configured", async () => {
    const fetchSpy = mockFetch();
    const config = buildConfig();

    await requestProviderTokens(config, new URLSearchParams([["grant_type", "authorization_code"]]));

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, init] = fetchSpy.mock.calls[0];
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers.authorization).toMatch(/^Basic\s+/);
    const params = new URLSearchParams(init?.body as URLSearchParams);
    expect(params.get("client_id")).toBe("up-client");
    expect(params.has("client_secret")).toBe(false);
  });

  it("sends credentials in the request body when client_secret_post is selected", async () => {
    const fetchSpy = mockFetch();
    const config = buildConfig({ upstreamTokenEndpointAuthMethod: "client_secret_post" });

    await requestProviderTokens(config, new URLSearchParams([["grant_type", "refresh_token"]]));

    const [, init] = fetchSpy.mock.calls[0];
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers.authorization).toBeUndefined();
    const params = new URLSearchParams(init?.body as URLSearchParams);
    expect(params.get("client_id")).toBe("up-client");
    expect(params.get("client_secret")).toBe("secret");
  });

  it("omits credentials when upstream auth method is none", async () => {
    const fetchSpy = mockFetch();
    const config = buildConfig({
      upstreamTokenEndpointAuthMethod: "none",
      upstreamClientSecretEncrypted: null,
    });

    await requestProviderTokens(config, new URLSearchParams([["grant_type", "authorization_code"]]));

    const [, init] = fetchSpy.mock.calls[0];
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers.authorization).toBeUndefined();
    const params = new URLSearchParams(init?.body as URLSearchParams);
    expect(params.get("client_id")).toBe("up-client");
    expect(params.has("client_secret")).toBe(false);
  });

  it("throws when a secret-backed method is selected without a secret", async () => {
    mockFetch();
    const config = buildConfig({ upstreamClientSecretEncrypted: null });

    await expect(requestProviderTokens(config, new URLSearchParams())).rejects.toThrow("basic auth");
  });
});

