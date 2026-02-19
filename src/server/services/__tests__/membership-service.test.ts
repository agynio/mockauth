import { addHours } from "date-fns";
import { randomUUID } from "crypto";

import { prisma } from "@/server/db/client";
import {
  acceptInviteLink,
  createInvite,
  removeMember,
  updateMemberRole,
} from "@/server/services/membership-service";
import { hashOpaqueToken } from "@/server/crypto/opaque-token";
import { DomainError } from "@/server/errors";
import { describe, expect, it } from "vitest";

const createTenantWithOwner = async () => {
  const tenant = await prisma.tenant.create({ data: { name: `Membership Tenant ${randomUUID()}` } });
  const apiResource = await prisma.apiResource.create({ data: { tenantId: tenant.id, name: "Default" } });
  await prisma.tenant.update({ where: { id: tenant.id }, data: { defaultApiResourceId: apiResource.id } });
  const owner = await prisma.adminUser.create({
    data: { email: `owner+${randomUUID()}@example.test`, name: "Owner" },
  });
  const membership = await prisma.tenantMembership.create({
    data: { tenantId: tenant.id, adminUserId: owner.id, role: "OWNER" },
  });
  return { tenant, owner, membership };
};

describe("membership service", () => {
  it("creates invites with hashed tokens", async () => {
    const { tenant, owner } = await createTenantWithOwner();
    const expiresAt = addHours(new Date(), 1);
    const { invite, token } = await createInvite({ tenantId: tenant.id, createdByUserId: owner.id, role: "WRITER", expiresAt });

    expect(invite.role).toBe("WRITER");
    expect(invite.tokenHash).toBe(hashOpaqueToken(token));
  });

  it("accepts invites and upgrades membership", async () => {
    const { tenant, owner } = await createTenantWithOwner();
    const target = await prisma.adminUser.create({ data: { email: `collab+${randomUUID()}@example.test`, name: "Collaborator" } });
    await prisma.tenantMembership.create({ data: { tenantId: tenant.id, adminUserId: target.id, role: "READER" } });

    const expiresAt = addHours(new Date(), 1);
    const { invite, token } = await createInvite({ tenantId: tenant.id, createdByUserId: owner.id, role: "WRITER", expiresAt });
    const result = await acceptInviteLink({ inviteId: invite.id, token, userId: target.id });

    expect(result.role).toBe("WRITER");
    const updatedMembership = await prisma.tenantMembership.findUnique({
      where: { tenantId_adminUserId: { tenantId: tenant.id, adminUserId: target.id } },
    });
    expect(updatedMembership?.role).toBe("WRITER");
    const storedInvite = await prisma.invite.findUnique({ where: { id: invite.id } });
    expect(storedInvite?.usedAt).toBeTruthy();
    expect(storedInvite?.usedByUserId).toBe(target.id);
  });

  it("prevents demoting the last owner", async () => {
    const { tenant, membership } = await createTenantWithOwner();

    await expect(updateMemberRole(tenant.id, membership.id, "WRITER")).rejects.toThrow(DomainError);
    await expect(removeMember(tenant.id, membership.id)).rejects.toThrow(DomainError);
  });
});
