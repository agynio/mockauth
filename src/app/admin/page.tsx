import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { formatDistanceToNow } from "date-fns";

import { RotateKeyButton } from "@/app/admin/_components/rotate-key-button";
import { TenantDangerZone } from "@/app/admin/_components/tenant-danger-zone";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { authOptions } from "@/server/auth/options";
import { getAdminTenantContext } from "@/server/services/admin-tenant-context";
import { listClients } from "@/server/services/client-service";
import { getActiveKey } from "@/server/services/key-service";
import { getRequestOrigin } from "@/server/utils/request-origin";

export default async function AdminPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    redirect("/api/auth/signin");
  }

  const tenantContext = await getAdminTenantContext(session.user.id);
  const activeTenant = tenantContext.activeTenant;

  if (!activeTenant) {
    return (
      <Card className="border-dashed">
        <CardHeader>
          <CardTitle>Welcome to Mockauth</CardTitle>
          <CardDescription>Create your first tenant from the sidebar to access admin tools.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const [clientSnapshot, activeKey, origin] = await Promise.all([
    listClients(activeTenant.id, { pageSize: 5 }),
    getActiveKey(activeTenant.id).catch(() => null),
    getRequestOrigin(),
  ]);

  const redirectCount = clientSnapshot.clients.reduce((acc, client) => acc + client._count.redirectUris, 0);
  const lastUpdated = clientSnapshot.clients[0]?.updatedAt;
  const defaultResourceId = activeTenant.defaultApiResourceId;
  if (!defaultResourceId) {
    throw new Error("Active tenant is missing a default API resource");
  }
  const issuer = `${origin}/r/${defaultResourceId}/oidc`;

  const viewerRole = tenantContext.activeMembership?.role ?? "READER";
  const stats = [
    { label: "Clients", value: clientSnapshot.total, helper: `${activeTenant.name}` },
    { label: "Redirect URIs", value: redirectCount, helper: "across visible clients" },
  ];

  return (
    <div className="space-y-8">
      <Card className="bg-gradient-to-br from-primary/10 via-background to-background">
        <CardHeader className="flex flex-wrap items-center justify-between gap-6">
          <div>
            <CardTitle className="text-2xl">Admin overview</CardTitle>
            <CardDescription>Monitor tenants, signing keys, and relying parties.</CardDescription>
          </div>
          <Button asChild>
            <Link href="/admin/clients">Go to clients</Link>
          </Button>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-8">
          <div>
            <p className="text-xs uppercase text-muted-foreground">Active tenant</p>
            <p className="text-xl font-semibold">{activeTenant.name}</p>
            <p className="font-mono text-xs text-muted-foreground">{activeTenant.id}</p>
          </div>
          <div>
            <p className="text-xs uppercase text-muted-foreground">Issuer</p>
            <p className="font-mono text-xs">{issuer}</p>
          </div>
          <div>
            <p className="text-xs uppercase text-muted-foreground">Your role</p>
            <p className="text-sm font-semibold capitalize">{viewerRole.toLowerCase()}</p>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        {stats.map((stat) => (
          <Card key={stat.label}>
            <CardHeader>
              <CardDescription>{stat.label}</CardDescription>
              <CardTitle className="text-3xl">{stat.value}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">{stat.helper}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Signing key</CardTitle>
            <CardDescription>Rotate keys to invalidate existing tokens.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {activeKey ? (
              <>
                <div className="text-sm">
                  <p className="font-semibold">KID</p>
                  <p className="font-mono text-xs text-muted-foreground">{activeKey.kid}</p>
                </div>
                <p className="text-xs text-muted-foreground">
                  Created {formatDistanceToNow(activeKey.createdAt, { addSuffix: true })}
                </p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">No active signing key found.</p>
            )}
            <RotateKeyButton tenantId={activeTenant.id} canRotate={viewerRole === "OWNER"} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent clients</CardTitle>
            <CardDescription>Latest activity scoped to {activeTenant.name}.</CardDescription>
          </CardHeader>
          <CardContent>
            {clientSnapshot.clients.length === 0 ? (
              <p className="text-sm text-muted-foreground">No clients yet. Create one to start issuing credentials.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Client</TableHead>
                    <TableHead className="hidden sm:table-cell">Updated</TableHead>
                    <TableHead className="text-right">Redirects</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {clientSnapshot.clients.map((client) => (
                    <TableRow key={client.id}>
                      <TableCell>
                        <p className="font-medium">{client.name}</p>
                        <p className="font-mono text-xs text-muted-foreground">{client.clientId}</p>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        {formatDistanceToNow(client.updatedAt, { addSuffix: true })}
                      </TableCell>
                      <TableCell className="text-right text-sm">{client._count.redirectUris}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            {lastUpdated && (
              <p className="mt-4 text-xs text-muted-foreground">Last change {formatDistanceToNow(lastUpdated, { addSuffix: true })}</p>
            )}
          </CardContent>
        </Card>
      </div>

      <TenantDangerZone tenantId={activeTenant.id} tenantName={activeTenant.name} canDelete={viewerRole === "OWNER"} />
    </div>
  );
}
