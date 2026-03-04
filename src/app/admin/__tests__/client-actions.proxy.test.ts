/* @vitest-environment node */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("@/server/auth/options", () => ({ authOptions: {} }));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/server/services/tenant-service", () => ({
  assertTenantMembership: vi.fn(),
  assertTenantRole: vi.fn(),
  ensureMembershipRole: vi.fn(),
  createTenant: vi.fn(),
  deleteTenant: vi.fn(),
  getTenantMemberships: vi.fn(),
}));

vi.mock("@/server/services/client-service", async () => {
  const actual = await vi.importActual<typeof import("@/server/services/client-service")>(
    "@/server/services/client-service",
  );
  return {
    ...actual,
    addRedirectUri: vi.fn(),
    createClient: vi.fn(),
    rotateClientSecret: vi.fn(),
    updateClientName: vi.fn(),
    updateClientApiResource: vi.fn(),
    updateClientAuthStrategies: vi.fn(),
    updateClientReauthTtl: vi.fn(),
    updateClientAllowedScopes: vi.fn(),
    getConfidentialClientSecret: vi.fn(),
    updateClientSigningAlgorithms: vi.fn(),
    upsertProxyProviderConfig: vi.fn(),
  };
});

vi.mock("@/server/db/client", () => ({
  prisma: {
    client: {
      findUnique: vi.fn(),
    },
    redirectUri: {
      findUnique: vi.fn(),
      delete: vi.fn(),
    },
    tenant: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("@/server/utils/request-origin", () => ({
  getRequestOrigin: vi.fn(),
}));

import { createClientAction, updateProxyClientConfigAction } from "../actions";
import { getServerSession } from "next-auth";
import { assertTenantMembership, ensureMembershipRole } from "@/server/services/tenant-service";
import { createClient, upsertProxyProviderConfig } from "@/server/services/client-service";
import { prisma } from "@/server/db/client";
import { getRequestOrigin } from "@/server/utils/request-origin";

const mockGetServerSession = vi.mocked(getServerSession);
const mockAssertTenantMembership = vi.mocked(assertTenantMembership);
const mockEnsureMembershipRole = vi.mocked(ensureMembershipRole);
const mockCreateClient = vi.mocked(createClient);
const mockUpsertProxyConfig = vi.mocked(upsertProxyProviderConfig);
const mockFindClient = vi.mocked(prisma.client.findUnique);
const mockGetRequestOrigin = vi.mocked(getRequestOrigin);
const mockFindTenant = vi.mocked(prisma.tenant.findUnique);

describe("proxy client server actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerSession.mockResolvedValue({ user: { id: "admin_1" } } as never);
    mockAssertTenantMembership.mockResolvedValue({ tenantId: "tenant_123", role: "OWNER" } as never);
    mockEnsureMembershipRole.mockImplementation(() => undefined);
    mockCreateClient.mockResolvedValue({
      client: { id: "client_internal", clientId: "client_public" } as never,
      clientSecret: "secret-generated",
    });
    mockFindClient.mockResolvedValue({
      id: "client_internal",
      tenantId: "tenant_123",
      clientType: "CONFIDENTIAL",
      oauthClientMode: "proxy",
    } as never);
    mockUpsertProxyConfig.mockResolvedValue(undefined);
    mockGetRequestOrigin.mockResolvedValue("https://mockauth.test");
    mockFindTenant.mockResolvedValue({ defaultApiResourceId: "api-default" } as never);
  });

  it("creates a proxy client with normalized configuration", async () => {
    const result = await createClientAction({
      tenantId: "tenant_123",
      name: "Proxy Client",
      type: "CONFIDENTIAL",
      redirects: ["https://client.example.test/callback"],
      scopes: ["openid", "profile"],
      mode: "proxy",
      proxyConfig: {
        providerType: "oidc",
        authorizationEndpoint: " https://idp.example.test/oauth2/authorize ",
        tokenEndpoint: "https://idp.example.test/oauth2/token ",
        userinfoEndpoint: " https://idp.example.test/oauth2/userinfo ",
        jwksUri: " https://idp.example.test/oauth2/jwks.json ",
        upstreamClientId: " upstream-client ",
        upstreamClientSecret: " upstream-secret ",
        defaultScopes: ["openid", "profile", "profile"],
        scopeMapping: { " profile:read ": ["openid", "profile "] },
        pkceSupported: false,
        oidcEnabled: true,
        promptPassthroughEnabled: true,
        loginHintPassthroughEnabled: false,
        passthroughTokenResponse: true,
      },
    });

    expect(mockCreateClient).toHaveBeenCalledWith(
      "tenant_123",
      expect.objectContaining({
        name: "Proxy Client",
        clientType: "CONFIDENTIAL",
        redirectUris: ["https://client.example.test/callback"],
        allowedScopes: ["openid", "profile"],
        oauthClientMode: "proxy",
        proxyConfig: expect.objectContaining({
          providerType: "oidc",
          authorizationEndpoint: "https://idp.example.test/oauth2/authorize",
          tokenEndpoint: "https://idp.example.test/oauth2/token",
          userinfoEndpoint: "https://idp.example.test/oauth2/userinfo",
          jwksUri: "https://idp.example.test/oauth2/jwks.json",
          upstreamClientId: "upstream-client",
          upstreamClientSecret: "upstream-secret",
          defaultScopes: ["openid", "profile", "profile"],
          scopeMapping: { "profile:read": ["openid", "profile"] },
          pkceSupported: false,
          oidcEnabled: true,
          promptPassthroughEnabled: true,
          loginHintPassthroughEnabled: false,
          passthroughTokenResponse: true,
          upstreamTokenEndpointAuthMethod: "client_secret_basic",
        }),
      }),
    );

    expect(result).toEqual({
      success: "Client created",
      data: {
        clientId: "client_public",
        clientSecret: "secret-generated",
        providerRedirectUri: "https://mockauth.test/r/api-default/oidc/proxy/callback",
      },
    });
  });

  it("rejects proxy client creation when configuration is missing", async () => {
    const result = await createClientAction({
      tenantId: "tenant_123",
      name: "Incomplete Proxy",
      type: "CONFIDENTIAL",
      scopes: ["openid"],
      mode: "proxy",
      proxyConfig: undefined,
    });

    expect(result).toEqual({ error: "Proxy configuration is required" });
    expect(mockCreateClient).not.toHaveBeenCalled();
  });

  it("updates proxy configuration and keeps existing secret when not provided", async () => {
    const result = await updateProxyClientConfigAction({
      clientId: "client_internal",
      providerType: "oidc",
      authorizationEndpoint: "https://idp.example.test/oauth2/authorize",
      tokenEndpoint: "https://idp.example.test/oauth2/token",
      upstreamClientId: "upstream-client",
      upstreamClientSecret: " ",
      defaultScopes: ["openid", "profile"],
      scopeMapping: { " profile:read ": "openid   profile" },
      pkceSupported: true,
      oidcEnabled: true,
      promptPassthroughEnabled: false,
      loginHintPassthroughEnabled: false,
      passthroughTokenResponse: false,
    });

    expect(mockUpsertProxyConfig).toHaveBeenCalledWith(
      "client_internal",
      {
        providerType: "oidc",
        authorizationEndpoint: "https://idp.example.test/oauth2/authorize",
        tokenEndpoint: "https://idp.example.test/oauth2/token",
        userinfoEndpoint: undefined,
        jwksUri: undefined,
        upstreamClientId: "upstream-client",
        upstreamClientSecret: undefined,
        defaultScopes: ["openid", "profile"],
        scopeMapping: { "profile:read": ["openid", "profile"] },
        pkceSupported: true,
        oidcEnabled: true,
        promptPassthroughEnabled: false,
        loginHintPassthroughEnabled: false,
        passthroughTokenResponse: false,
        upstreamTokenEndpointAuthMethod: "client_secret_basic",
      },
      { keepExistingSecret: true },
    );

    expect(result).toEqual({ success: "Upstream configuration updated" });
  });

  it("validates proxy configuration before updating", async () => {
    const result = await updateProxyClientConfigAction({
      clientId: "client_internal",
      providerType: "oidc",
      authorizationEndpoint: "https://idp.example.test/oauth2/authorize",
      tokenEndpoint: "https://idp.example.test/oauth2/token",
      upstreamClientId: "upstream-client",
      scopeMapping: { "profile:read": "" },
    });

    expect(result).toEqual({ error: "Scope mapping for profile:read must include provider scopes" });
    expect(mockUpsertProxyConfig).not.toHaveBeenCalled();
  });
});
