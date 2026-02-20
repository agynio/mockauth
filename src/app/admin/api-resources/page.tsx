import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";

import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { authOptions } from "@/server/auth/options";
import { getAdminTenantContext } from "@/server/services/admin-tenant-context";
import { listApiResources } from "@/server/services/api-resource-service";
import { getRequestOrigin } from "@/server/utils/request-origin";
import { ApiResourcesClient } from "./api-resources-client";

type ResourceRecord = {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
};

export default async function ApiResourcesPage() {
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
          <CardDescription>Choose or create a tenant from the sidebar to manage API resources.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const [resources, origin] = await Promise.all([
    listApiResources(activeTenant.id),
    getRequestOrigin(),
  ]);

  const resourceRecords: ResourceRecord[] = resources.map((resource) => ({
    id: resource.id,
    name: resource.name,
    description: resource.description ?? null,
    createdAt: resource.createdAt.toISOString(),
  }));

  return (
    <ApiResourcesClient
      tenantId={activeTenant.id}
      tenantName={activeTenant.name}
      viewerRole={activeMembership.role}
      defaultResourceId={activeTenant.defaultApiResourceId!}
      resources={resourceRecords}
      origin={origin}
    />
  );
}
