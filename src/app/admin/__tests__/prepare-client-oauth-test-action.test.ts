/* @vitest-environment node */

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("@/server/auth/options", () => ({ authOptions: {} }));

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
    getConfidentialClientSecret: vi.fn(),
  };
});

vi.mock("@/server/services/oauth-test-service", () => ({
  createOauthTestSession: vi.fn(),
  resetOauthTestSessionsForClient: vi.fn(),
}));

vi.mock("@/server/oauth/test-cookie", () => ({
  setOauthTestSecretCookie: vi.fn(),
  clearOauthTestSecretCookie: vi.fn(),
}));

vi.mock("@/server/utils/request-origin", () => ({
  getRequestOrigin: vi.fn(),
}));

vi.mock("@/server/oidc/url-builder", () => ({
  buildOidcUrls: vi.fn(),
}));

vi.mock("@/server/oidc/redirect-uri", () => ({
  resolveRedirectUri: vi.fn(),
}));

vi.mock("@/server/crypto/pkce", () => ({
  computeS256Challenge: vi.fn(),
}));

vi.mock("node:crypto", async () => {
  const actual = await vi.importActual<typeof import("node:crypto")>("node:crypto");
  return {
    ...actual,
    randomBytes: vi.fn(() => Buffer.from("12345678901234567890123456789012")),
    randomUUID: vi.fn(() => "new_state"),
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
  },
}));

import { prepareClientOauthTestAction } from "../actions";
import { getServerSession } from "next-auth";
import { prisma } from "@/server/db/client";
import { getConfidentialClientSecret } from "@/server/services/client-service";
import { getRequestOrigin } from "@/server/utils/request-origin";
import { buildOidcUrls } from "@/server/oidc/url-builder";
import { computeS256Challenge } from "@/server/crypto/pkce";
import { createOauthTestSession, resetOauthTestSessionsForClient } from "@/server/services/oauth-test-service";
import { clearOauthTestSecretCookie, setOauthTestSecretCookie } from "@/server/oauth/test-cookie";

const mockGetServerSession = vi.mocked(getServerSession);
const mockFindClient = vi.mocked(prisma.client.findUnique);
const mockGetSecret = vi.mocked(getConfidentialClientSecret);
const mockOrigin = vi.mocked(getRequestOrigin);
const mockBuildUrls = vi.mocked(buildOidcUrls);
const mockS256 = vi.mocked(computeS256Challenge);
const mockCreateSession = vi.mocked(createOauthTestSession);
const mockResetSessions = vi.mocked(resetOauthTestSessionsForClient);
const mockClearSecretCookie = vi.mocked(clearOauthTestSecretCookie);
const mockSetSecretCookie = vi.mocked(setOauthTestSecretCookie);

describe("prepareClientOauthTestAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerSession.mockResolvedValue({ user: { id: "admin_1" } } as never);
    mockFindClient.mockResolvedValue({
      id: "client_internal",
      clientId: "client_public",
      tenantId: "tenant_123",
      name: "Test Client",
      clientType: "CONFIDENTIAL",
      tenant: { id: "tenant_123", defaultApiResourceId: "resource_123", defaultApiResource: { id: "resource_123" } },
      apiResourceId: null,
      apiResource: null,
      redirectUris: [{ id: "redirect_1", uri: "https://admin.example.test/callback" }],
      tokenEndpointAuthMethod: "client_secret_basic",
    } as never);
    mockGetSecret.mockResolvedValue("stored-secret");
    mockOrigin.mockResolvedValue("https://admin.example.test");
    mockBuildUrls.mockReturnValue({
      issuer: "https://issuer.example",
      discovery: "https://issuer.example/.well-known/openid-configuration",
      jwks: "https://issuer.example/jwks.json",
      authorize: "https://issuer.example/authorize",
      token: "https://issuer.example/token",
      userinfo: "https://issuer.example/userinfo",
    });
    mockS256.mockReturnValue("pkce-challenge");
    mockCreateSession.mockResolvedValue(undefined);
    mockResetSessions.mockResolvedValue(["stale_state"]);
  });

  it("resets existing sessions and cookies before generating a new authorization URL", async () => {
    const result = await prepareClientOauthTestAction({
      clientId: "client_internal",
      redirectUri: "https://admin.example.test/callback",
      scopes: "openid profile",
    });

    expect(mockResetSessions).toHaveBeenCalledWith("client_internal", "admin_1");
    expect(mockClearSecretCookie).toHaveBeenCalledWith("client_internal", "stale_state");
    expect(mockCreateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "new_state",
        clientId: "client_internal",
        adminUserId: "admin_1",
        scopes: "openid profile",
      }),
    );
    expect(mockSetSecretCookie).toHaveBeenCalledWith("client_internal", "new_state", "stored-secret");
    expect(result?.data?.authorizationUrl).toContain("state=new_state");
  });

  it("appends prompt=login when requested", async () => {
    const result = await prepareClientOauthTestAction({
      clientId: "client_internal",
      redirectUri: "https://admin.example.test/callback",
      scopes: "openid",
      promptLogin: true,
    });

    expect(result.data?.authorizationUrl).toContain("prompt=login");
  });
});
