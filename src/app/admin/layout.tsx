import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";

import { AdminShell } from "@/app/admin/_components/admin-shell";
import { authOptions } from "@/server/auth/options";
import { getAdminTenantContext } from "@/server/services/admin-tenant-context";

export const metadata = {
  title: "Mockauth Admin",
};

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    redirect("/api/auth/signin");
  }

  const user = session.user!;
  const tenantContext = await getAdminTenantContext(user.id);
  const tenantSummaries = tenantContext.memberships.map((membership) => ({
    id: membership.tenantId,
    name: membership.tenant.name,
  }));

  return (
    <AdminShell user={user} tenants={tenantSummaries} activeTenantId={tenantContext.activeTenant?.id ?? null}>
      {children}
    </AdminShell>
  );
}
