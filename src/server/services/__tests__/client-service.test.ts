import { randomUUID } from "crypto";

import { prisma } from "@/server/db/client";
import { decrypt } from "@/server/crypto/key-vault";
import {
  createClient,
  getClientByIdForTenant,
  rotateClientSecret,
  updateClientSigningAlgorithms,
} from "@/server/services/client-service";
import { describe, expect, it } from "vitest";

const createTenant = async () => {
  const tenant = await prisma.tenant.create({
    data: {
      name: `Client Test Tenant ${randomUUID()}`,
    },
  });
  const apiResource = await prisma.apiResource.create({
    data: {
      tenantId: tenant.id,
      name: "Default",
    },
  });
  await prisma.tenant.update({ where: { id: tenant.id }, data: { defaultApiResourceId: apiResource.id } });
  return tenant;
};

describe("client service", () => {
  it("creates a client with redirect URIs", async () => {
    const tenant = await createTenant();
    const { client, clientSecret } = await createClient(tenant.id, {
      name: "Admin E2E",
      clientType: "CONFIDENTIAL",
      redirectUris: [
        "https://example.com/callback",
        "https://*.example.com/post-login",
      ],
    });

    expect(client.clientId).toMatch(/^client_/);
    expect(clientSecret).toBeDefined();

    const stored = await prisma.client.findUnique({
      where: { id: client.id },
      include: { redirectUris: true },
    });
    expect(stored?.redirectUris).toHaveLength(2);
    expect(stored?.clientSecretHash).toBeTruthy();
    expect(stored?.clientSecretEncrypted).toBeTruthy();
    expect(stored?.allowedScopes).toEqual(["openid", "profile", "email"]);
    expect(decrypt(stored?.clientSecretEncrypted as string)).toEqual(clientSecret);
  });

  it("allows configuring custom scopes", async () => {
    const tenant = await createTenant();
    const { client } = await createClient(tenant.id, {
      name: "QA Tester",
      clientType: "PUBLIC",
      allowedScopes: ["openid", "tenant:write", "profile"],
    });

    const stored = await prisma.client.findUnique({ where: { id: client.id } });
    expect(stored?.allowedScopes).toEqual(["openid", "tenant:write", "profile"]);
  });

  it("rejects invalid scope formats", async () => {
    const tenant = await createTenant();
    await expect(
      createClient(tenant.id, {
        name: "Bad Scope",
        clientType: "PUBLIC",
        allowedScopes: ["openid", "invalid scope"],
      }),
    ).rejects.toThrowError("Invalid scope format: invalid scope");
  });

  it("fetches a client scoped to a tenant", async () => {
    const tenant = await createTenant();
    const { client } = await createClient(tenant.id, {
      name: "SPA",
      clientType: "PUBLIC",
      redirectUris: ["https://spa.test/callback"],
    });

    const fetched = await getClientByIdForTenant(tenant.id, client.id);
    expect(fetched.id).toBe(client.id);
    expect(fetched.redirectUris).toHaveLength(1);
  });

  it("rotates confidential client secrets", async () => {
    const tenant = await createTenant();
    const { client } = await createClient(tenant.id, {
      name: "Machine",
      clientType: "CONFIDENTIAL",
    });

    const original = await prisma.client.findUnique({ where: { id: client.id } });
    const nextSecret = await rotateClientSecret(client.id);
    expect(nextSecret).toBeDefined();

    const updated = await prisma.client.findUnique({ where: { id: client.id } });
    expect(updated?.clientSecretHash).not.toEqual(original?.clientSecretHash);
    expect(updated?.clientSecretEncrypted).not.toEqual(original?.clientSecretEncrypted);
    expect(decrypt(updated?.clientSecretEncrypted as string)).toEqual(nextSecret);
  });

  it("updates signing algorithms with nullable defaults", async () => {
    const tenant = await createTenant();
    const { client } = await createClient(tenant.id, {
      name: "Alg Tester",
      clientType: "PUBLIC",
    });

    await updateClientSigningAlgorithms(client.id, { idTokenAlg: "ES384", accessTokenAlg: "PS256" });

    let refreshed = await prisma.client.findUnique({ where: { id: client.id } });
    expect(refreshed?.idTokenSignedResponseAlg).toBe("ES384");
    expect(refreshed?.accessTokenSigningAlg).toBe("PS256");

    await updateClientSigningAlgorithms(client.id, { idTokenAlg: null, accessTokenAlg: null });

    refreshed = await prisma.client.findUnique({ where: { id: client.id } });
    expect(refreshed?.idTokenSignedResponseAlg).toBeNull();
    expect(refreshed?.accessTokenSigningAlg).toBeNull();
  });
});
