/* @vitest-environment jsdom */

import { render, screen, within } from "@testing-library/react";
import { describe, beforeEach, it, expect, vi } from "vitest";

import { DEFAULT_CLIENT_AUTH_STRATEGIES } from "@/server/oidc/auth-strategy";

import ClientDetailPage from "../[clientId]/page";

const mockGetServerSession = vi.hoisted(() => vi.fn());
const mockGetAdminTenantContext = vi.hoisted(() => vi.fn());
const mockGetClientByIdForTenant = vi.hoisted(() => vi.fn());
const mockListApiResources = vi.hoisted(() => vi.fn());
const mockGetRequestOrigin = vi.hoisted(() => vi.fn());

vi.mock("next-auth", () => ({
  getServerSession: mockGetServerSession,
}));

const redirectMock = vi.hoisted(() => vi.fn());
const notFoundMock = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  redirect: redirectMock,
  notFound: notFoundMock,
}));

vi.mock("@/server/services/admin-tenant-context", () => ({
  getAdminTenantContext: mockGetAdminTenantContext,
}));

vi.mock("@/server/services/client-service", async (importActual) => {
  const actual = await importActual<any>();
  return {
    ...actual,
    getClientByIdForTenant: mockGetClientByIdForTenant,
  };
});

vi.mock("@/server/services/api-resource-service", () => ({
  listApiResources: mockListApiResources,
}));

vi.mock("@/server/utils/request-origin", () => ({
  getRequestOrigin: mockGetRequestOrigin,
}));

vi.mock("../[clientId]/client-forms", () => ({
  UpdateClientNameForm: () => <div data-testid="client-name-form" />,
  ChangeClientTypeForm: () => <div data-testid="client-type-form" />,
  UpdateClientIssuerForm: () => <div data-testid="client-issuer-form" />,
  UpdateProxyProviderConfigForm: ({
    initialConfig,
    storedSecret,
  }: {
    initialConfig: unknown;
    storedSecret?: string | null;
  }) => <div data-testid="proxy-config-form">{JSON.stringify({ initialConfig, storedSecret })}</div>,
  UpdateClientScopesForm: () => <div data-testid="client-scopes-form" />,
  UpdateAuthStrategiesForm: () => <div data-testid="client-auth-form" />,
  UpdateClientSigningAlgorithmsForm: () => <div data-testid="client-signing-form" />,
  UpdateClientReauthTtlForm: () => <div data-testid="client-reauth-form" />,
  AddRedirectForm: () => <div data-testid="add-redirect-form" />,
  DeleteRedirectButton: () => <button type="button" data-testid="delete-redirect-btn" />,
  RotateSecretForm: () => <div data-testid="rotate-secret-form" />,
}));

vi.mock("../[clientId]/client-danger-zone", () => ({
  ClientDangerZone: () => <div data-testid="client-danger-zone" />,
}));

describe("ClientDetailPage proxy mode", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockGetServerSession.mockResolvedValue({ user: { id: "admin_1" } });
    mockGetAdminTenantContext.mockResolvedValue({
      activeTenant: { id: "tenant_1", defaultApiResourceId: "api-default", name: "Tenant One" },
      activeMembership: { role: "OWNER" },
    });
    mockListApiResources.mockResolvedValue([
      { id: "api-default", name: "Default resource" },
      { id: "api-secondary", name: "Secondary" },
    ]);
    mockGetRequestOrigin.mockResolvedValue("https://mockauth.test");

    mockGetClientByIdForTenant.mockResolvedValue({
      id: "client_internal",
      tenantId: "tenant_1",
      name: "Proxy Client",
      clientId: "client_proxy",
      clientType: "PUBLIC",
      clientSecretEncrypted: null,
      tokenEndpointAuthMethod: "none",
      oauthClientMode: "proxy",
      allowedScopes: ["openid", "profile"],
      allowedGrantTypes: ["authorization_code", "refresh_token"],
      allowedResponseTypes: ["code"],
      authStrategies: DEFAULT_CLIENT_AUTH_STRATEGIES,
      redirectUris: [{ id: "redirect_1", uri: "https://app.example.test/callback", type: "EXACT" }],
      tenant: { id: "tenant_1", defaultApiResourceId: "api-default", defaultApiResource: { id: "api-default", name: "Default" } },
      apiResource: null,
      proxyConfig: {
        providerType: "oidc",
        authorizationEndpoint: "https://upstream.example.com/oauth2/authorize",
        tokenEndpoint: "https://upstream.example.com/oauth2/token",
        userinfoEndpoint: null,
        jwksUri: null,
        upstreamClientId: "up-client",
        upstreamClientSecretEncrypted: null,
        defaultScopes: ["openid"],
        scopeMapping: { profile: ["profile.read"] },
        pkceSupported: true,
        oidcEnabled: true,
        promptPassthroughEnabled: true,
        loginHintPassthroughEnabled: false,
        passthroughTokenResponse: false,
        upstreamTokenEndpointAuthMethod: "client_secret_post",
      },
      reauthTtlSeconds: 0,
      idTokenSignedResponseAlg: null,
      accessTokenSigningAlg: null,
      createdAt: new Date("2024-01-01T00:00:00.000Z"),
      updatedAt: new Date("2024-01-02T00:00:00.000Z"),
    });
  });

  it("shows upstream configuration details and hides local settings", async () => {
    const page = await ClientDetailPage({ params: Promise.resolve({ clientId: "client_proxy" }) });
    render(page);

    const providerField = screen.getByTestId("provider-redirect-uri");
    expect(within(providerField).getByText("https://mockauth.test/r/api-default/oidc/proxy/callback")).toBeInTheDocument();
    expect(screen.getByTestId("proxy-mode-note")).toBeInTheDocument();

    expect(screen.queryByTestId("client-scopes-card")).not.toBeInTheDocument();
    expect(screen.queryByTestId("client-auth-strategies-card")).not.toBeInTheDocument();
    expect(screen.queryByTestId("client-signing-card")).not.toBeInTheDocument();
    expect(screen.queryByTestId("client-reauth-card")).not.toBeInTheDocument();
  });
});
