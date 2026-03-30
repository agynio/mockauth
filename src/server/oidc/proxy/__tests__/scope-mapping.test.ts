import { describe, expect, it } from "vitest";

import type { ProxyProviderConfig } from "@/generated/prisma/client";
import { mapAppScopesToProvider, parseScopeMapping } from "@/server/oidc/proxy/scope-mapping";

const buildConfig = (overrides: Partial<ProxyProviderConfig> = {}): ProxyProviderConfig => ({
  id: "proxy-config",
  clientId: "client",
  providerType: "oidc",
  authorizationEndpoint: "https://provider.example/authorize",
  tokenEndpoint: "https://provider.example/token",
  userinfoEndpoint: null,
  jwksUri: null,
  upstreamClientId: "up-client",
  upstreamClientSecretEncrypted: "secret",
  upstreamTokenEndpointAuthMethod: "client_secret_basic",
  defaultScopes: ["openid"],
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

describe("scope mapping", () => {
  it("parses mappings with trimmed scope values", () => {
    const mapping = parseScopeMapping({
      profile: "profile.read  profile.write",
      email: [" email.read ", 42, ""],
      empty: [],
    });

    expect(mapping.get("profile")).toEqual(["profile.read", "profile.write"]);
    expect(mapping.get("email")).toEqual(["email.read"]);
    expect(mapping.get("empty")).toEqual([]);
  });

  it("maps requested scopes through provider mapping", () => {
    const config = buildConfig({
      scopeMapping: {
        profile: ["profile.read"],
        email: "email.read",
      },
    });

    const result = mapAppScopesToProvider("openid profile email", config);
    expect(result.split(" ")).toEqual(["openid", "profile.read", "email.read"]);
  });

  it("falls back to default scopes when mapping is empty", () => {
    const config = buildConfig({
      defaultScopes: ["openid", "profile"],
      scopeMapping: {},
    });

    const result = mapAppScopesToProvider("", config);
    expect(result.split(" ")).toEqual(["openid", "profile"]);
  });
});
