import type { Invite, MembershipRole, Prisma, TenantMembership } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";
import { generateOpaqueToken, hashOpaqueToken } from "@/server/crypto/opaque-token";
import { DomainError } from "@/server/errors";
import { maxRole } from "@/server/services/tenant-service";

type MemberWithUser = Prisma.TenantMembershipGetPayload<{ include: { adminUser: true } }>;
type InviteWithMeta = Prisma.InviteGetPayload<{ include: { createdBy: true; usedBy: true } }>;

const INVITE_TOKEN_BYTES = 32;

export const listTenantMembers = async (tenantId: string): Promise<MemberWithUser[]> => {
  return prisma.tenantMembership.findMany({
    where: { tenantId },
    include: { adminUser: true },
    orderBy: { createdAt: "asc" },
  });
};

export const listTenantInvites = async (tenantId: string): Promise<InviteWithMeta[]> => {
  return prisma.invite.findMany({
    where: { tenantId },
    include: { createdBy: true, usedBy: true },
    orderBy: { createdAt: "desc" },
  });
};

export const createInvite = async (params: {
  tenantId: string;
  createdByUserId: string;
  role: MembershipRole;
  expiresAt: Date;
}): Promise<{ invite: Invite; token: string }> => {
  if (params.role === "OWNER") {
    throw new DomainError("Owner invites are not supported", { status: 400 });
  }

  const token = generateOpaqueToken(INVITE_TOKEN_BYTES);
  const tokenHash = hashOpaqueToken(token);

  const invite = await prisma.invite.create({
    data: {
      tenantId: params.tenantId,
      role: params.role,
      tokenHash,
      expiresAt: params.expiresAt,
      createdByUserId: params.createdByUserId,
    },
  });

  return { invite, token };
};

export const revokeInvite = async (tenantId: string, inviteId: string) => {
  const invite = await prisma.invite.findUnique({ where: { id: inviteId } });
  if (!invite || invite.tenantId !== tenantId) {
    throw new DomainError("Invite not found", { status: 404 });
  }
  if (invite.usedAt) {
    throw new DomainError("Invite is already used", { status: 400 });
  }
  if (invite.revokedAt) {
    return invite;
  }

  return prisma.invite.update({ where: { id: invite.id }, data: { revokedAt: new Date() } });
};

const ensureNotLastOwner = async (tenantId: string, membership: TenantMembership) => {
  if (membership.role !== "OWNER") {
    return;
  }

  const ownerCount = await prisma.tenantMembership.count({ where: { tenantId, role: "OWNER" } });
  if (ownerCount <= 1) {
    throw new DomainError("Each tenant must retain at least one owner", { status: 400, code: "last_owner" });
  }
};

export const updateMemberRole = async (tenantId: string, membershipId: string, role: MembershipRole) => {
  const membership = await prisma.tenantMembership.findUnique({ where: { id: membershipId } });
  if (!membership || membership.tenantId !== tenantId) {
    throw new DomainError("Member not found", { status: 404 });
  }
  if (membership.role === role) {
    return membership;
  }

  if (role !== "OWNER") {
    await ensureNotLastOwner(tenantId, membership);
  }

  return prisma.tenantMembership.update({ where: { id: membership.id }, data: { role } });
};

export const removeMember = async (tenantId: string, membershipId: string) => {
  const membership = await prisma.tenantMembership.findUnique({ where: { id: membershipId } });
  if (!membership || membership.tenantId !== tenantId) {
    throw new DomainError("Member not found", { status: 404 });
  }

  await ensureNotLastOwner(tenantId, membership);
  await prisma.tenantMembership.delete({ where: { id: membership.id } });
};

export const acceptInviteLink = async (params: {
  inviteId: string;
  token: string;
  userId: string;
}): Promise<{ tenantName: string; tenantId: string; role: MembershipRole }> => {
  const tokenHash = hashOpaqueToken(params.token);
  const now = new Date();

  return prisma.$transaction(async (tx) => {
    const invite = await tx.invite.findUnique({
      where: { id: params.inviteId },
      include: { tenant: true },
    });

    if (!invite) {
      throw new DomainError("Invite not found", { status: 404 });
    }
    if (invite.tokenHash !== tokenHash) {
      throw new DomainError("Invalid invite token", { status: 400, code: "invalid_token" });
    }
    if (invite.revokedAt) {
      throw new DomainError("Invite was revoked", { status: 400, code: "invite_revoked" });
    }
    if (invite.usedAt) {
      throw new DomainError("Invite already used", { status: 400, code: "invite_used" });
    }
    if (invite.expiresAt <= now) {
      throw new DomainError("Invite expired", { status: 400, code: "invite_expired" });
    }

    const existingMembership = await tx.tenantMembership.findUnique({
      where: { tenantId_adminUserId: { tenantId: invite.tenantId, adminUserId: params.userId } },
    });

    const resultingRole = existingMembership ? maxRole(existingMembership.role, invite.role) : invite.role;

    if (existingMembership) {
      if (existingMembership.role !== resultingRole) {
        await tx.tenantMembership.update({
          where: { id: existingMembership.id },
          data: { role: resultingRole },
        });
      }
    } else {
      await tx.tenantMembership.create({
        data: {
          tenantId: invite.tenantId,
          adminUserId: params.userId,
          role: invite.role,
        },
      });
    }

    const updated = await tx.invite.updateMany({
      where: { id: invite.id, usedAt: null, revokedAt: null },
      data: { usedAt: now, usedByUserId: params.userId },
    });

    if (updated.count === 0) {
      throw new DomainError("Invite can no longer be used", { status: 400, code: "invite_unavailable" });
    }

    return { tenantName: invite.tenant.name, tenantId: invite.tenantId, role: resultingRole };
  });
};
