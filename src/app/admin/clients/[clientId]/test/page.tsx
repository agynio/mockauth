import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getServerSession } from "next-auth";

import { CopyField } from "@/app/admin/_components/copy-field";
import { TestOAuthConfigurator } from "@/app/admin/clients/[clientId]/test/test-oauth-configurator";
import { DEFAULT_TEST_SCOPES } from "@/app/admin/clients/[clientId]/test/constants";
import { authOptions } from "@/server/auth/options";
import { getAdminTenantContext } from "@/server/services/admin-tenant-context";
import { getClientByIdForTenant } from "@/server/services/client-service";
import { getRequestOrigin } from "@/server/utils/request-origin";
import { resolveRedirectUri } from "@/server/oidc/redirect-uri";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type PageParams = Promise<{ clientId: string }>;

export default async function ClientTestOAuthPage({ params }: { params: PageParams }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    redirect("/api/auth/signin");
  }

  const { clientId } = await params;
  const { activeTenant, activeMembership } = await getAdminTenantContext(session.user.id);
  if (!activeTenant) {
    redirect("/admin/clients");
  }

  const client = await getClientByIdForTenant(activeTenant.id, clientId).catch(() => null);
  if (!client) {
    notFound();
  }

  const origin = await getRequestOrigin();

  const testRedirectUri = `${origin}/admin/clients/${client.id}/test/redirect`;
  const redirectAllowed = (() => {
    try {
      resolveRedirectUri(testRedirectUri, client.redirectUris);
      return true;
    } catch {
      return false;
    }
  })();

  const viewerRole = activeMembership?.role ?? "READER";
  const canManageRedirects = viewerRole === "OWNER" || viewerRole === "WRITER";
  const requiresClientSecret = client.tokenEndpointAuthMethod !== "none";

  return (
    <div className="space-y-8">
      <Button asChild variant="ghost" size="sm">
        <Link href={`/admin/clients/${client.id}`}>← Back to client</Link>
      </Button>
      <Card>
        <CardHeader>
          <CardTitle>Test OAuth for {client.name}</CardTitle>
          <CardDescription>
            Generate a PKCE authorization URL, run the login flow, and capture tokens using the admin-only redirect page.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <CopyField
            label="Client ID"
            value={client.clientId}
            description="This value is included automatically when you start the test."
          />
          <p className="text-sm text-muted-foreground">
            The admin test redirect stays on this domain so you can inspect the authorization response, tokens, and decoded claims
            after the provider redirects back.
          </p>
          <TestOAuthConfigurator
            clientId={client.id}
            defaultScopes={DEFAULT_TEST_SCOPES}
            defaultRedirectUri={testRedirectUri}
            canManageRedirects={canManageRedirects}
            redirectAllowed={redirectAllowed}
            requiresClientSecret={requiresClientSecret}
          />
        </CardContent>
      </Card>
    </div>
  );
}
