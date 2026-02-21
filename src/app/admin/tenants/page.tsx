import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";

import { TenantsClient } from "@/app/admin/tenants/tenants-client";
import { authOptions } from "@/server/auth/options";
import { getAdminTenantContext } from "@/server/services/admin-tenant-context";

export const metadata = {
  title: "Tenants · Mockauth Admin",
};

export default async function TenantsPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    redirect("/api/auth/signin");
  }

  const tenantContext = await getAdminTenantContext(session.user.id);
  const tenants = tenantContext.memberships.map((membership) => ({
    membershipId: membership.id,
    tenantId: membership.tenantId,
    name: membership.tenant.name,
    role: membership.role,
    createdAt: membership.tenant.createdAt.toISOString(),
  }));

  return <TenantsClient tenants={tenants} activeTenantId={tenantContext.activeTenant?.id ?? null} />;
}
