import type { Session } from "next-auth";

import { CreateTenantForm, TenantSwitcher } from "@/app/admin/_components/tenant-controls";
import { SidebarNav } from "@/app/admin/_components/sidebar-nav";
import { UserBadge } from "@/app/admin/_components/user-badge";

type TenantSummary = {
  id: string;
  name: string;
};

type Props = {
  user: Session["user"];
  tenants: TenantSummary[];
  activeTenantId: string | null;
};

const NAV_ITEMS = [{ href: "/admin/clients", label: "Clients", description: "Manage client credentials" }];

export function AdminSidebar({ user, tenants, activeTenantId }: Props) {
  return (
    <aside className="flex w-80 flex-col border-r border-white/5 bg-slate-950/80">
      <div className="border-b border-white/5 px-6 py-6">
        <p className="text-xs uppercase tracking-[0.2em] text-amber-300">Mockauth</p>
        <h1 className="mt-2 text-xl font-semibold text-white">Admin console</h1>
        <p className="text-sm text-slate-400">Configure tenants and OAuth clients</p>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-6">
        <SidebarNav items={NAV_ITEMS} />
      </div>
      <div className="space-y-5 border-t border-white/5 px-5 py-5">
        <TenantSwitcher tenants={tenants} activeTenantId={activeTenantId} />
        <CreateTenantForm />
        {user ? <UserBadge user={user} /> : null}
      </div>
    </aside>
  );
}
