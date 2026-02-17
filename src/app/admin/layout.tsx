import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";

import { AdminSidebar } from "@/app/admin/_components/sidebar";
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
    <div className="flex min-h-screen bg-slate-950 text-white">
      <AdminSidebar user={user} tenants={tenantSummaries} activeTenantId={tenantContext.activeTenant?.id ?? null} />
      <main className="flex-1 overflow-y-auto bg-slate-950/70">
        <div className="mx-auto w-full max-w-5xl px-10 py-10">{children}</div>
      </main>
    </div>
  );
}
