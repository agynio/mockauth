import { randomUUID } from "crypto";

import { KeyStatus } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";
import { getJwks, getPublicJwkByKid, ensureActiveKeyForAlg, rotateKeyForAlg } from "@/server/services/key-service";
import { describe, expect, it, vi } from "vitest";

const createTenant = async () => {
  const tenant = await prisma.tenant.create({
    data: {
      name: `Key Service Test Tenant ${randomUUID()}`,
    },
  });
  const apiResource = await prisma.apiResource.create({ data: { tenantId: tenant.id, name: "Default" } });
  await prisma.tenant.update({ where: { id: tenant.id }, data: { defaultApiResourceId: apiResource.id } });
  return tenant;
};

describe("key rotation", () => {
  it("keeps the previous key available as rotated", async () => {
    const tenant = await createTenant();
    const current = await ensureActiveKeyForAlg(tenant.id, "RS256");
    const next = await rotateKeyForAlg(tenant.id, "RS256");

    expect(next.tenantId).toBe(tenant.id);
    expect(next.alg).toBe("RS256");

    const original = await prisma.tenantKey.findUnique({ where: { id: current.id } });
    expect(original?.status).toBe(KeyStatus.ROTATED);
    expect(original?.alg).toBe("RS256");

    const jwks = await getJwks(tenant.id);
    expect(jwks.some((jwk) => jwk.kid === original?.kid)).toBe(true);

    const fetched = await getPublicJwkByKid(tenant.id, original!.kid);
    expect(fetched.kid).toBe(original?.kid);
  });

  it("reuses an existing transaction client", async () => {
    const tenant = await createTenant();
    await ensureActiveKeyForAlg(tenant.id, "RS256");

    const outerTransaction = prisma.$transaction.bind(prisma);
    await outerTransaction(async (tx) => {
      const proxy = prisma as typeof prisma & { $transaction: typeof prisma.$transaction };
      const original = proxy.$transaction;
      proxy.$transaction = vi.fn(() => {
        throw new Error("rotateKey should not open a nested transaction");
      }) as typeof prisma.$transaction;

      try {
        await rotateKeyForAlg(tenant.id, "RS256", tx);
      } finally {
        proxy.$transaction = original;
      }
    });
  });

  it("maintains separate active keys per algorithm", async () => {
    const tenant = await createTenant();
    const rsaKey = await ensureActiveKeyForAlg(tenant.id, "RS256");
    const esKey = await ensureActiveKeyForAlg(tenant.id, "ES384");

    expect(rsaKey.alg).toBe("RS256");
    expect(esKey.alg).toBe("ES384");

    const activeKeys = await prisma.tenantKey.findMany({
      where: { tenantId: tenant.id, status: KeyStatus.ACTIVE },
    });

    expect(activeKeys.filter((key) => key.alg === "RS256")).toHaveLength(1);
    expect(activeKeys.filter((key) => key.alg === "ES384")).toHaveLength(1);
  });
});
