import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";

import { NewClientForm } from "@/app/admin/clients/new/client-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { authOptions } from "@/server/auth/options";
import { getAdminTenantContext } from "@/server/services/admin-tenant-context";

export default async function NewClientPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    redirect("/api/auth/signin");
  }

  const { activeTenant, activeMembership } = await getAdminTenantContext(session.user.id);

  if (!activeTenant) {
    return (
      <Card className="border-dashed">
        <CardHeader className="text-center">
          <CardTitle>Select a tenant</CardTitle>
          <CardDescription>Use the sidebar to create or activate a tenant before registering clients.</CardDescription>
        </CardHeader>
        <CardContent className="flex justify-center">
          <Button variant="outline" asChild>
            <Link href="/admin/clients">Back to clients</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const role = activeMembership?.role ?? "READER";
  if (role === "READER") {
    return (
      <Card className="border-destructive/30">
        <CardHeader className="text-center">
          <CardTitle>Read-only access</CardTitle>
          <CardDescription>You need writer or owner privileges to create clients.</CardDescription>
        </CardHeader>
        <CardContent className="flex justify-center">
          <Button variant="outline" asChild>
            <Link href="/admin/clients">Back to clients</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-sm uppercase tracking-wide text-muted-foreground">Tenant · {activeTenant.name}</p>
          <h1 className="text-3xl font-semibold tracking-tight">New client</h1>
          <p className="text-sm text-muted-foreground">Provision OAuth credentials for relying parties.</p>
        </div>
        <Button variant="ghost" asChild>
          <Link href="/admin/clients">Back to list</Link>
        </Button>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Client configuration</CardTitle>
          <CardDescription>Define metadata and redirects. Secrets are displayed once after creation.</CardDescription>
        </CardHeader>
        <CardContent>
          <NewClientForm tenantId={activeTenant.id} />
        </CardContent>
      </Card>
    </div>
  );
}
