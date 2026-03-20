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
    getConfidentialClientSecret: vi.fn(),
    changeClientType: vi.fn(),
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

import { changeClientTypeAction } from "../actions";
import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db/client";
import { assertTenantMembership } from "@/server/services/tenant-service";
import { changeClientType } from "@/server/services/client-service";
import { DomainError } from "@/server/errors";

const mockSession = vi.mocked(getServerSession);
const mockRevalidate = vi.mocked(revalidatePath);
const mockFindClient = vi.mocked(prisma.client.findUnique);
const mockAssertMembership = vi.mocked(assertTenantMembership);
const mockChangeClientType = vi.mocked(changeClientType);

describe("changeClientTypeAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.mockResolvedValue({ user: { id: "admin_1" } } as never);
    mockAssertMembership.mockResolvedValue({ role: "OWNER" } as never);
    mockFindClient.mockResolvedValue({
      id: "client_internal",
      tenantId: "tenant_1",
      name: "Public App",
      clientType: "PUBLIC",
      oauthClientMode: "regular",
      tokenEndpointAuthMethod: "none",
    } as never);
    mockChangeClientType.mockResolvedValue({
      client: {
        id: "client_internal",
        tenantId: "tenant_1",
        tokenEndpointAuthMethod: "client_secret_basic",
      },
      clientSecret: "new-secret",
    } as never);
  });

  it("switches public clients to confidential and returns a secret", async () => {
    const result = await changeClientTypeAction({ clientId: "client_internal", newType: "CONFIDENTIAL" });

    expect(result).toEqual({ success: "Client type updated", data: { clientSecret: "new-secret" } });
    expect(mockChangeClientType).toHaveBeenCalledWith("client_internal", "CONFIDENTIAL");
    expect(mockRevalidate).toHaveBeenCalledWith("/admin/clients/client_internal");
    expect(mockRevalidate).toHaveBeenCalledWith("/admin/clients");
  });

  it("switches confidential clients to public without a secret", async () => {
    mockFindClient.mockResolvedValueOnce({
      id: "client_internal",
      tenantId: "tenant_1",
      name: "Confidential App",
      clientType: "CONFIDENTIAL",
      oauthClientMode: "regular",
      tokenEndpointAuthMethod: "client_secret_basic",
    } as never);
    mockChangeClientType.mockResolvedValueOnce({
      client: {
        id: "client_internal",
        tenantId: "tenant_1",
        tokenEndpointAuthMethod: "none",
      },
      clientSecret: null,
    } as never);

    const result = await changeClientTypeAction({ clientId: "client_internal", newType: "PUBLIC" });

    expect(result).toEqual({ success: "Client type updated" });
    expect(mockChangeClientType).toHaveBeenCalledWith("client_internal", "PUBLIC");
  });

  it("returns an error when the client is missing", async () => {
    mockFindClient.mockResolvedValueOnce(null as never);

    const result = await changeClientTypeAction({ clientId: "missing", newType: "PUBLIC" });

    expect(result).toEqual({ error: "Client not found" });
    expect(mockChangeClientType).not.toHaveBeenCalled();
  });

  it("surfaces same-type errors from the service", async () => {
    mockChangeClientType.mockRejectedValueOnce(new DomainError("Client is already public"));

    const result = await changeClientTypeAction({ clientId: "client_internal", newType: "PUBLIC" });

    expect(result).toEqual({ error: "Client is already public" });
  });
});
