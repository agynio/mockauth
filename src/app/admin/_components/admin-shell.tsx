"use client";

import { useState } from "react";
import { LogOut, Menu } from "lucide-react";
import { signOut } from "next-auth/react";

import { ModeToggle } from "@/components/mode-toggle";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";

import { CreateTenantDialog } from "./tenant-controls";
import { AdminSidebar } from "./sidebar";

type AdminShellProps = {
  children: React.ReactNode;
  user: {
    name?: string | null;
    email?: string | null;
    image?: string | null;
  };
  tenants: { id: string; name: string }[];
  activeTenantId: string | null;
};

export function AdminShell({ children, user, tenants, activeTenantId }: AdminShellProps) {
  const [tenantDialogOpen, setTenantDialogOpen] = useState(false);
  const handleLogout = () => {
    void signOut({ callbackUrl: "/api/auth/signin" });
  };

  return (
    <div className="flex min-h-screen bg-muted/20">
      <aside className="hidden border-r bg-background/95 md:block md:w-72">
        <AdminSidebar
          user={user}
          tenants={tenants}
          activeTenantId={activeTenantId}
          onAddTenant={() => setTenantDialogOpen(true)}
        />
      </aside>

      <div className="flex flex-1 flex-col">
        <header className="sticky top-0 z-40 border-b bg-background/90 backdrop-blur">
          <div className="flex h-16 items-center gap-3 px-4 sm:px-6 lg:px-10">
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="md:hidden">
                  <Menu className="h-5 w-5" />
                  <span className="sr-only">Open navigation</span>
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-72 p-0">
                <AdminSidebar
                  user={user}
                  tenants={tenants}
                  activeTenantId={activeTenantId}
                  onAddTenant={() => setTenantDialogOpen(true)}
                />
              </SheetContent>
            </Sheet>
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Mockauth</p>
              <p className="text-sm font-semibold leading-tight">Admin console</p>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <ModeToggle />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="md:hidden"
                onClick={handleLogout}
                aria-label="Logout"
              >
                <LogOut className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="hidden md:inline-flex"
                onClick={handleLogout}
                data-testid="logout-button"
              >
                <LogOut className="mr-2 h-4 w-4" />
                Logout
              </Button>
            </div>
          </div>
        </header>
        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-10">
          <div className="mx-auto w-full max-w-5xl space-y-8">{children}</div>
        </main>
      </div>

      <CreateTenantDialog open={tenantDialogOpen} onOpenChange={setTenantDialogOpen} />
    </div>
  );
}
