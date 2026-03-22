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

import { updateClientSigningAlgsAction } from "../actions";
import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db/client";
import { assertTenantMembership } from "@/server/services/tenant-service";
import { updateClientSigningAlgorithms } from "@/server/services/client-service";

const mockSession = vi.mocked(getServerSession);
const mockRevalidate = vi.mocked(revalidatePath);
const mockFindClient = vi.mocked(prisma.client.findUnique);
const mockAssertMembership = vi.mocked(assertTenantMembership);
const mockUpdateSigning = vi.mocked(updateClientSigningAlgorithms);

describe("updateClientSigningAlgsAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.mockResolvedValue({ user: { id: "admin_1" } } as never);
    mockAssertMembership.mockResolvedValue({ role: "OWNER" } as never);
    mockFindClient.mockResolvedValue({
      id: "client_internal",
      tenantId: "tenant_1",
      tokenEndpointAuthMethods: ["client_secret_basic"],
    } as never);
    mockUpdateSigning.mockResolvedValue({} as never);
  });

  it("updates signing algorithms when overrides are provided", async () => {
    const result = await updateClientSigningAlgsAction({
      clientId: "client_internal",
      idTokenAlg: "ES384",
      accessTokenAlg: "PS256",
    });

    expect(result).toEqual({ success: "Signing algorithms updated" });
    expect(mockUpdateSigning).toHaveBeenCalledWith("client_internal", {
      idTokenAlg: "ES384",
      accessTokenAlg: "PS256",
    });
    expect(mockRevalidate).toHaveBeenCalledWith("/admin/clients/client_internal");
    expect(mockRevalidate).toHaveBeenCalledWith("/admin/clients");
    expect(mockRevalidate).toHaveBeenCalledWith("/admin", "layout");
  });

  it("resets algorithms to defaults when using match options", async () => {
    const result = await updateClientSigningAlgsAction({
      clientId: "client_internal",
      idTokenAlg: "default",
      accessTokenAlg: "match_id",
    });

    expect(result).toEqual({ success: "Signing algorithms updated" });
    expect(mockUpdateSigning).toHaveBeenCalledWith("client_internal", {
      idTokenAlg: null,
      accessTokenAlg: null,
    });
  });

  it("returns an error when the client is missing", async () => {
    mockFindClient.mockResolvedValueOnce(null as never);

    const result = await updateClientSigningAlgsAction({
      clientId: "missing",
      idTokenAlg: "RS256",
      accessTokenAlg: "match_id",
    });

    expect(result).toEqual({ error: "Client not found" });
    expect(mockUpdateSigning).not.toHaveBeenCalled();
  });

  it("fails validation for unsupported algorithms", async () => {
    const result = await updateClientSigningAlgsAction({
      clientId: "client_internal",
      idTokenAlg: "HS256" as never,
      accessTokenAlg: "match_id",
    });

    expect(result).toEqual({ error: "Unable to update signing algorithms" });
    expect(mockUpdateSigning).not.toHaveBeenCalled();
  });
});
