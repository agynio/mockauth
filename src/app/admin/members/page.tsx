import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";

import type { MembershipRole } from "@/generated/prisma/client";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { authOptions } from "@/server/auth/options";
import { getAdminTenantContext } from "@/server/services/admin-tenant-context";
import { listTenantInvites, listTenantMembers } from "@/server/services/membership-service";
import { MembersClient } from "./members-client";

type MemberRecord = {
  id: string;
  role: MembershipRole;
  adminUser: {
    id: string;
    name: string | null;
    email: string | null;
  };
  createdAt: string;
};

type InviteRecord = {
  id: string;
  tenantId: string;
  role: MembershipRole;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  usedAt: string | null;
  createdBy: {
    name: string | null;
    email: string | null;
  };
  usedBy: {
    name: string | null;
    email: string | null;
  } | null;
};

export default async function MembersPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    redirect("/api/auth/signin");
  }

  const context = await getAdminTenantContext(session.user.id);
  const activeTenant = context.activeTenant;
  const activeMembership = context.activeMembership;

  if (!activeTenant || !activeMembership) {
    return (
      <Card className="border-dashed">
        <CardHeader className="text-center">
          <CardTitle>No tenant selected</CardTitle>
          <CardDescription>Choose or create a tenant from the sidebar to manage members.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const [members, invites] = await Promise.all([
    listTenantMembers(activeTenant.id),
    listTenantInvites(activeTenant.id),
  ]);

  const memberRecords: MemberRecord[] = members.map((member) => ({
    id: member.id,
    role: member.role,
    adminUser: {
      id: member.adminUserId,
      name: member.adminUser?.name ?? member.adminUser?.email ?? "Unknown user",
      email: member.adminUser?.email ?? null,
    },
    createdAt: member.createdAt.toISOString(),
  }));

  const inviteRecords: InviteRecord[] = invites.map((invite) => ({
    id: invite.id,
    tenantId: invite.tenantId,
    role: invite.role,
    createdAt: invite.createdAt.toISOString(),
    expiresAt: invite.expiresAt.toISOString(),
    revokedAt: invite.revokedAt ? invite.revokedAt.toISOString() : null,
    usedAt: invite.usedAt ? invite.usedAt.toISOString() : null,
    createdBy: {
      name: invite.createdBy?.name ?? invite.createdBy?.email ?? "Unknown",
      email: invite.createdBy?.email ?? null,
    },
    usedBy: invite.usedBy
      ? {
          name: invite.usedBy.name ?? invite.usedBy.email ?? "Unknown",
          email: invite.usedBy.email ?? null,
        }
      : null,
  }));

  return (
    <MembersClient
      tenantId={activeTenant.id}
      tenantName={activeTenant.name}
      viewerId={session.user.id}
      viewerRole={activeMembership.role}
      members={memberRecords}
      invites={inviteRecords}
    />
  );
}
