/* @vitest-environment node */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
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
    updateClientReauthTtl: vi.fn(),
    updateClientAllowedScopes: vi.fn(),
    updateClientSigningAlgorithms: vi.fn(),
    getClientSecret: vi.fn(),
    updateClientTokenConfig: vi.fn(),
    deleteClient: vi.fn(),
  };
});

vi.mock("@/server/db/client", () => ({
  prisma: {
    client: {
      findUnique: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
  },
}));

import { updateClientTokenConfigAction } from "../actions";
import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db/client";
import { assertTenantMembership } from "@/server/services/tenant-service";
import { updateClientTokenConfig } from "@/server/services/client-service";
import { DomainError } from "@/server/errors";

const mockSession = vi.mocked(getServerSession);
const mockRevalidate = vi.mocked(revalidatePath);
const mockFindClient = vi.mocked(prisma.client.findUnique);
const mockAssertMembership = vi.mocked(assertTenantMembership);
const mockUpdateTokenConfig = vi.mocked(updateClientTokenConfig);

describe("updateClientTokenConfigAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.mockResolvedValue({ user: { id: "admin_1" } } as never);
    mockAssertMembership.mockResolvedValue({ role: "OWNER" } as never);
    mockFindClient.mockResolvedValue({
      id: "client_internal",
      tenantId: "tenant_1",
      name: "Public App",
      oauthClientMode: "regular",
      tokenEndpointAuthMethods: ["none"],
      pkceRequired: true,
    } as never);
    mockUpdateTokenConfig.mockResolvedValue({
      client: {
        id: "client_internal",
        tenantId: "tenant_1",
        tokenEndpointAuthMethods: ["client_secret_basic"],
      },
      clientSecret: "new-secret",
    } as never);
  });

  it("adds secret auth methods and returns a secret", async () => {
    const result = await updateClientTokenConfigAction({
      clientId: "client_internal",
      tokenEndpointAuthMethods: ["client_secret_basic"],
      pkceRequired: true,
      allowedGrantTypes: ["authorization_code"],
    });

    expect(result).toEqual({ success: "Client token settings updated", data: { clientSecret: "new-secret" } });
    expect(mockUpdateTokenConfig).toHaveBeenCalledWith({
      clientId: "client_internal",
      tokenEndpointAuthMethods: ["client_secret_basic"],
      pkceRequired: true,
      allowedGrantTypes: ["authorization_code"],
    });
    expect(mockRevalidate).toHaveBeenCalledWith("/admin/clients/client_internal");
    expect(mockRevalidate).toHaveBeenCalledWith("/admin/clients");
  });

  it("removes secrets when switching to none auth", async () => {
    mockFindClient.mockResolvedValueOnce({
      id: "client_internal",
      tenantId: "tenant_1",
      name: "Confidential App",
      oauthClientMode: "regular",
      tokenEndpointAuthMethods: ["client_secret_basic"],
      pkceRequired: true,
    } as never);
    mockUpdateTokenConfig.mockResolvedValueOnce({
      client: {
        id: "client_internal",
        tenantId: "tenant_1",
        tokenEndpointAuthMethods: ["none"],
      },
      clientSecret: null,
    } as never);

    const result = await updateClientTokenConfigAction({
      clientId: "client_internal",
      tokenEndpointAuthMethods: ["none"],
      pkceRequired: true,
      allowedGrantTypes: ["authorization_code"],
    });

    expect(result).toEqual({ success: "Client token settings updated" });
    expect(mockUpdateTokenConfig).toHaveBeenCalledWith({
      clientId: "client_internal",
      tokenEndpointAuthMethods: ["none"],
      pkceRequired: true,
      allowedGrantTypes: ["authorization_code"],
    });
  });

  it("returns an error when the client is missing", async () => {
    mockFindClient.mockResolvedValueOnce(null as never);

    const result = await updateClientTokenConfigAction({
      clientId: "missing",
      tokenEndpointAuthMethods: ["none"],
      pkceRequired: true,
      allowedGrantTypes: ["authorization_code"],
    });

    expect(result).toEqual({ error: "Client not found" });
    expect(mockUpdateTokenConfig).not.toHaveBeenCalled();
  });

  it("surfaces token config errors from the service", async () => {
    mockUpdateTokenConfig.mockRejectedValueOnce(new DomainError("At least one token auth method is required"));

    const result = await updateClientTokenConfigAction({
      clientId: "client_internal",
      tokenEndpointAuthMethods: ["client_secret_basic"],
      pkceRequired: true,
      allowedGrantTypes: ["authorization_code"],
    });

    expect(result).toEqual({ error: "At least one token auth method is required" });
  });
});
