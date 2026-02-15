import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";
import { DomainError } from "@/server/errors";
import { rotateKey } from "@/server/services/key-service";

export const getActiveTenantBySlug = async (slug: string) => {
  const tenant = await prisma.tenant.findUnique({ where: { slug } });
  if (!tenant || tenant.status !== "ACTIVE") {
    throw new DomainError("Unknown tenant", { status: 404, code: "tenant_not_found" });
  }
  return tenant;
};

type MembershipWithTenant = Prisma.TenantMembershipGetPayload<{ include: { tenant: true } }>;

export const getTenantMemberships = async (adminUserId: string): Promise<MembershipWithTenant[]> => {
  return prisma.tenantMembership.findMany({
    where: { adminUserId },
    include: { tenant: true },
    orderBy: { createdAt: "asc" },
  });
};

export const assertTenantMembership = async (adminUserId: string, tenantId: string) => {
  const membership = await prisma.tenantMembership.findUnique({
    where: { tenantId_adminUserId: { tenantId, adminUserId } },
  });

  if (!membership) {
    throw new DomainError("You are not a member of this tenant", { status: 403 });
  }

  return membership;
};

export const createTenant = async (adminUserId: string, data: { slug: string; name: string }) => {
  return prisma.$transaction(async (tx) => {
    const tenant = await tx.tenant.create({
      data: {
        slug: data.slug,
        name: data.name,
      },
    });

    await tx.tenantMembership.create({
      data: {
        tenantId: tenant.id,
        adminUserId,
        role: "OWNER",
      },
    });
    await rotateKey(tenant.id);
    return tenant;
  });
};
