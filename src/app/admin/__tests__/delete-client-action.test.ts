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

import { deleteClientAction } from "../actions";
import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db/client";
import { assertTenantMembership } from "@/server/services/tenant-service";
import { deleteClient } from "@/server/services/client-service";

const mockSession = vi.mocked(getServerSession);
const mockRevalidate = vi.mocked(revalidatePath);
const mockFindClient = vi.mocked(prisma.client.findUnique);
const mockAssertMembership = vi.mocked(assertTenantMembership);
const mockDeleteClient = vi.mocked(deleteClient);

describe("deleteClientAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.mockResolvedValue({ user: { id: "admin_1" } } as never);
    mockAssertMembership.mockResolvedValue({ role: "OWNER" } as never);
    mockFindClient.mockResolvedValue({
      id: "client_internal",
      tenantId: "tenant_1",
      name: "Delete Me",
      clientType: "PUBLIC",
      oauthClientMode: "regular",
      tokenEndpointAuthMethod: "none",
    } as never);
    mockDeleteClient.mockResolvedValue({} as never);
  });

  it("deletes clients and revalidates admin paths", async () => {
    const result = await deleteClientAction({ clientId: "client_internal" });

    expect(result).toEqual({ success: "Client deleted" });
    expect(mockDeleteClient).toHaveBeenCalledWith("client_internal");
    expect(mockRevalidate).toHaveBeenCalledWith("/admin", "layout");
    expect(mockRevalidate).toHaveBeenCalledWith("/admin/clients");
  });

  it("returns an error when the client is missing", async () => {
    mockFindClient.mockResolvedValueOnce(null as never);

    const result = await deleteClientAction({ clientId: "missing" });

    expect(result).toEqual({ error: "Client not found" });
    expect(mockDeleteClient).not.toHaveBeenCalled();
  });

  it("returns an error when the session is missing", async () => {
    mockSession.mockResolvedValueOnce(null as never);

    const result = await deleteClientAction({ clientId: "client_internal" });

    expect(result).toEqual({ error: "Unauthorized" });
    expect(mockDeleteClient).not.toHaveBeenCalled();
  });
});
