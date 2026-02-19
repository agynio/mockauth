"use client";

import { LogOut } from "lucide-react";
import { signOut } from "next-auth/react";

import { SidebarNav } from "@/app/admin/_components/sidebar-nav";
import { TenantSwitcher } from "@/app/admin/_components/tenant-controls";
import { UserBadge } from "@/app/admin/_components/user-badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";

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
  { href: "/admin/api-resources", label: "API resources", description: "Manage issuers per tenant" },
  { href: "/admin/members", label: "Members", description: "Collaborate with your team" },
];

export function AdminSidebar({ user, tenants, activeTenantId, onAddTenant }: Props) {
  const handleLogout = () => {
    void signOut({ callbackUrl: "/api/auth/signin" });
  };

  return (
    <div className="flex h-full flex-col bg-background" data-testid="admin-sidebar">
      <div className="border-b px-6 py-5">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Control center</p>
        <h1 className="text-lg font-semibold text-foreground">Administration</h1>
      </div>
      <ScrollArea className="flex-1 px-4 py-6" data-testid="sidebar-nav-area">
        <SidebarNav items={NAV_ITEMS} />
      </ScrollArea>
      <div className="border-t px-4 py-5 space-y-5" data-testid="sidebar-footer">
        <TenantSwitcher tenants={tenants} activeTenantId={activeTenantId} onAddTenant={onAddTenant} />
        <div className="space-y-4" data-testid="sidebar-user-section">
          <UserBadge user={user} />
          <Button type="button" variant="outline" className="w-full" onClick={handleLogout}>
            <LogOut className="mr-2 h-4 w-4" />
            Logout
          </Button>
        </div>
      </div>
    </div>
  );
}
