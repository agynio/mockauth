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
    getClientSecret: vi.fn(),
    updateClientTokenConfig: vi.fn(),
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

import { updateClientScopesAction } from "../actions";
import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db/client";
import { assertTenantMembership } from "@/server/services/tenant-service";
import { updateClientAllowedScopes } from "@/server/services/client-service";

const mockSession = vi.mocked(getServerSession);
const mockRevalidate = vi.mocked(revalidatePath);
const mockFindClient = vi.mocked(prisma.client.findUnique);
const mockAssertMembership = vi.mocked(assertTenantMembership);
const mockUpdateScopes = vi.mocked(updateClientAllowedScopes);

describe("updateClientScopesAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.mockResolvedValue({ user: { id: "admin_42" } } as never);
    mockAssertMembership.mockResolvedValue({ role: "OWNER" } as never);
    mockFindClient.mockResolvedValue({
      id: "client_internal",
      tenantId: "tenant_1",
      tokenEndpointAuthMethods: ["none"],
    } as never);
    mockUpdateScopes.mockResolvedValue({} as never);
  });

  it("updates scopes with canonical ordering", async () => {
    const result = await updateClientScopesAction({ clientId: "client_internal", scopes: ["email", "openid", "profile"] });

    expect(result).toEqual({ success: "Scopes updated", data: { allowedScopes: ["openid", "email", "profile"] } });
    expect(mockUpdateScopes).toHaveBeenCalledWith("client_internal", ["openid", "email", "profile"]);
    expect(mockRevalidate).toHaveBeenCalledWith("/admin/clients/client_internal");
  });

  it("allows custom scopes that match the required pattern", async () => {
    const result = await updateClientScopesAction({
      clientId: "client_internal",
      scopes: ["openid", "profile", "r_organizationSocialAnalytics"],
    });

    expect(result).toEqual({
      success: "Scopes updated",
      data: { allowedScopes: ["openid", "profile", "r_organizationSocialAnalytics"] },
    });
    expect(mockUpdateScopes).toHaveBeenCalledWith("client_internal", ["openid", "profile", "r_organizationSocialAnalytics"]);
  });

  it("returns an error when openid is missing", async () => {
    const result = await updateClientScopesAction({ clientId: "client_internal", scopes: ["profile"] });

    expect(result).toEqual({ error: "Scopes must include openid" });
    expect(mockUpdateScopes).not.toHaveBeenCalled();
  });

  it("returns an error for invalid scope formats", async () => {
    const result = await updateClientScopesAction({ clientId: "client_internal", scopes: ["openid", "invalid scope"] });

    expect(result).toEqual({ error: "Scopes must match ^[A-Za-z0-9:_-]{1,64}$: invalid scope" });
    expect(mockUpdateScopes).not.toHaveBeenCalled();
  });

  it("fails when the client is not found", async () => {
    mockFindClient.mockResolvedValueOnce(null as never);
    const result = await updateClientScopesAction({ clientId: "missing_client", scopes: ["openid"] });

    expect(result).toEqual({ error: "Client not found" });
    expect(mockUpdateScopes).not.toHaveBeenCalled();
  });
});
