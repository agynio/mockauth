"use client";

import { Plus } from "lucide-react";

import { SidebarNav } from "@/app/admin/_components/sidebar-nav";
import { TenantSwitcher } from "@/app/admin/_components/tenant-controls";
import { UserBadge } from "@/app/admin/_components/user-badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";

type TenantSummary = {
  id: string;
  name: string;
};

type Props = {
  user: {
    name?: string | null;
    email?: string | null;
    image?: string | null;
  };
  tenants: TenantSummary[];
  activeTenantId: string | null;
  onAddTenant: () => void;
};

const NAV_ITEMS = [
  { href: "/admin", label: "Overview", description: "Tenant keys and SSO stats" },
  { href: "/admin/clients", label: "Clients", description: "Manage OAuth clients" },
  { href: "/admin/logs", label: "Logs", description: "Audit log (soon)" },
];

export function AdminSidebar({ user, tenants, activeTenantId, onAddTenant }: Props) {
  return (
    <div className="flex h-full flex-col bg-background">
      <div className="border-b px-6 py-5">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Control center</p>
        <h1 className="text-lg font-semibold text-foreground">Administration</h1>
      </div>
      <ScrollArea className="flex-1 px-4 py-6">
        <div className="space-y-6">
          <section>
            <h2 className="text-xs font-semibold uppercase text-muted-foreground">Navigation</h2>
            <div className="mt-3">
              <SidebarNav items={NAV_ITEMS} />
            </div>
          </section>
          <Separator />
          <section className="space-y-3">
            <TenantSwitcher tenants={tenants} activeTenantId={activeTenantId} onAddTenant={onAddTenant} />
            <Button
              type="button"
              variant="secondary"
              className="w-full"
              onClick={onAddTenant}
              data-testid="add-tenant-btn"
            >
              <Plus className="mr-2 h-4 w-4" />
              Create tenant
            </Button>
          </section>
        </div>
      </ScrollArea>
      <div className="border-t px-4 py-5">
        <UserBadge user={user} />
      </div>
    </div>
  );
}
