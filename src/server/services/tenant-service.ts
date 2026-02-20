import type { MembershipRole, Prisma, Tenant, TenantMembership } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";
import { DomainError } from "@/server/errors";
import { rotateKey } from "@/server/services/key-service";

const ROLE_RANK: Record<MembershipRole, number> = {
  OWNER: 3,
  WRITER: 2,
  READER: 1,
};

export const isOwnerRole = (role: MembershipRole): boolean => role === "OWNER";

export const ensureMembershipRole = (role: MembershipRole, allowedRoles: MembershipRole[]) => {
  if (!allowedRoles.includes(role)) {
    throw new DomainError("You do not have permission to perform this action", { status: 403, code: "forbidden" });
  }
};

export const maxRole = (left: MembershipRole, right: MembershipRole): MembershipRole => {
  return ROLE_RANK[left] >= ROLE_RANK[right] ? left : right;
};

export const getActiveTenantById = async (tenantId: string): Promise<Tenant & { defaultApiResourceId: string }> => {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant || tenant.status !== "ACTIVE") {
    throw new DomainError("Unknown tenant", { status: 404, code: "tenant_not_found" });
  }
  if (!tenant.defaultApiResourceId) {
    throw new DomainError("Tenant is missing a default API resource", { status: 500, code: "api_resource_missing" });
  }
  return tenant as Tenant & { defaultApiResourceId: string };
};

type MembershipWithTenant = Prisma.TenantMembershipGetPayload<{ include: { tenant: true } }>;

export const getTenantMemberships = async (adminUserId: string): Promise<MembershipWithTenant[]> => {
  return prisma.tenantMembership.findMany({
    where: { adminUserId },
    include: { tenant: true },
    orderBy: { createdAt: "asc" },
  });
};

export const assertTenantMembership = async (adminUserId: string, tenantId: string): Promise<TenantMembership> => {
  const membership = await prisma.tenantMembership.findUnique({
    where: { tenantId_adminUserId: { tenantId, adminUserId } },
  });

  if (!membership) {
    throw new DomainError("You are not a member of this tenant", { status: 403 });
  }

  return membership;
};

export const assertTenantRole = async (
  adminUserId: string,
  tenantId: string,
  allowedRoles: MembershipRole[],
): Promise<TenantMembership> => {
  const membership = await assertTenantMembership(adminUserId, tenantId);
  ensureMembershipRole(membership.role, allowedRoles);
  return membership;
};

export const createTenant = async (adminUserId: string, data: { name: string }) => {
  return prisma.$transaction(async (tx) => {
    const tenant = await tx.tenant.create({ data: { name: data.name } });
    const defaultResource = await tx.apiResource.create({
      data: {
        tenantId: tenant.id,
        name: `${data.name} default`,
        description: "Default issuer",
      },
    });
    const tenantWithDefault = await tx.tenant.update({
      where: { id: tenant.id },
      data: { defaultApiResourceId: defaultResource.id },
    });

    await tx.tenantMembership.create({
      data: {
        tenantId: tenant.id,
        adminUserId,
        role: "OWNER",
      },
    });
    await rotateKey(tenant.id, tx);
    return tenantWithDefault;
  });
};
