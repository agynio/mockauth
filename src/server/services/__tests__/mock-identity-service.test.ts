import { randomUUID } from "crypto";

import { describe, expect, it } from "vitest";

import { prisma } from "@/server/db/client";
import { findOrCreateMockIdentity } from "../mock-identity-service";

describe("mock identity service", () => {
  it("returns a stable subject for repeated identifiers", async () => {
    const identifier = `stable-user-${randomUUID()}`;
    const first = await findOrCreateMockIdentity({
      tenantId: "tenant_qa",
      strategy: "username",
      identifier,
    });
    const second = await findOrCreateMockIdentity({
      tenantId: "tenant_qa",
      strategy: "username",
      identifier: identifier.toUpperCase(),
    });
    expect(first.sub).toBe(second.sub);
  });

  it("isolates identities per tenant and strategy", async () => {
    const tenantOne = await prisma.tenant.create({ data: { name: `Mock Identity ${randomUUID()}` } });
    const tenantTwo = await prisma.tenant.create({ data: { name: `Mock Identity ${randomUUID()}` } });

    const usernameIdentity = await findOrCreateMockIdentity({
      tenantId: tenantOne.id,
      strategy: "username",
      identifier: "isolate",
    });
    const emailIdentity = await findOrCreateMockIdentity({
      tenantId: tenantOne.id,
      strategy: "email",
      identifier: "isolate@example.test",
      email: "isolate@example.test",
    });
    const otherTenantIdentity = await findOrCreateMockIdentity({
      tenantId: tenantTwo.id,
      strategy: "username",
      identifier: "isolate",
    });

    expect(usernameIdentity.sub).not.toBe(emailIdentity.sub);
    expect(usernameIdentity.sub).not.toBe(otherTenantIdentity.sub);

    await prisma.tenant.delete({ where: { id: tenantOne.id } });
    await prisma.tenant.delete({ where: { id: tenantTwo.id } });
  });
});
