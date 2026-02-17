import { randomUUID } from "crypto";

import { prisma } from "@/server/db/client";
import { createClient, getClientByIdForTenant, rotateClientSecret } from "@/server/services/client-service";
import { describe, expect, it } from "vitest";

const createTenant = async () => {
  return prisma.tenant.create({
    data: {
      name: `Client Test Tenant ${randomUUID()}`,
    },
  });
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
  });
});
