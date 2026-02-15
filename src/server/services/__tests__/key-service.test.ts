import { randomUUID } from "crypto";

import { KeyStatus } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";
import { getJwks, getPublicJwkByKid, ensureActiveKey, rotateKey } from "@/server/services/key-service";
import { describe, expect, it, vi } from "vitest";

const createTenant = async () => {
  return prisma.tenant.create({
    data: {
      slug: `test-${randomUUID()}`,
      name: "Key Service Test Tenant",
    },
  });
};

describe("key rotation", () => {
  it("keeps the previous key available as rotated", async () => {
    const tenant = await createTenant();
    const current = await ensureActiveKey(tenant.id);
    const next = await rotateKey(tenant.id);

    expect(next.tenantId).toBe(tenant.id);

    const original = await prisma.tenantKey.findUnique({ where: { id: current.id } });
    expect(original?.status).toBe(KeyStatus.ROTATED);

    const jwks = await getJwks(tenant.id);
    expect(jwks.some((jwk) => jwk.kid === original?.kid)).toBe(true);

    const fetched = await getPublicJwkByKid(tenant.id, original!.kid);
    expect(fetched.kid).toBe(original?.kid);
  });

  it("reuses an existing transaction client", async () => {
    const tenant = await createTenant();
    await ensureActiveKey(tenant.id);

    const outerTransaction = prisma.$transaction.bind(prisma);
    await outerTransaction(async (tx) => {
      const proxy = prisma as typeof prisma & { $transaction: typeof prisma.$transaction };
      const original = proxy.$transaction;
      proxy.$transaction = vi.fn(() => {
        throw new Error("rotateKey should not open a nested transaction");
      }) as typeof prisma.$transaction;

      try {
        await rotateKey(tenant.id, tx);
      } finally {
        proxy.$transaction = original;
      }
    });
  });
});
