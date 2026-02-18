import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { format } from "date-fns";

import { CopyBundleButton, CopyField } from "@/app/admin/_components/copy-field";
import { AddRedirectForm, DeleteRedirectButton, RotateSecretForm, UpdateClientNameForm } from "@/app/admin/clients/[clientId]/client-forms";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { authOptions } from "@/server/auth/options";
import { getAdminTenantContext } from "@/server/services/admin-tenant-context";
import { getClientByIdForTenant } from "@/server/services/client-service";
import { getRequestOrigin } from "@/server/utils/request-origin";

type PageParams = Promise<{ clientId: string }>;

export default async function ClientDetailPage({ params }: { params: PageParams }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    redirect("/api/auth/signin");
  }

  const { clientId } = await params;
  const { activeTenant } = await getAdminTenantContext(session.user.id);

  if (!activeTenant) {
    redirect("/admin/clients");
  }

  const client = await getClientByIdForTenant(activeTenant.id, clientId).catch(() => null);
  if (!client) {
    notFound();
  }

  const origin = await getRequestOrigin();
  const urls = buildOidcUrls(origin, activeTenant.id);
  const requiredParameters = [
    { label: "Client ID", value: client.clientId },
    { label: "Issuer", value: urls.issuer },
    { label: "Authorization endpoint", value: urls.authorize },
    { label: "Token endpoint", value: urls.token },
  ];
  const optionalParameters = [
    { label: "Discovery (.well-known)", value: urls.discovery },
    { label: "JWKS", value: urls.jwks },
    { label: "Userinfo", value: urls.userinfo },
  ];

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-3">
          <Button asChild variant="ghost" size="sm">
            <Link href="/admin/clients">← Back to clients</Link>
          </Button>
          <UpdateClientNameForm clientId={client.id} initialName={client.name} />
          <Badge variant={client.clientType === "CONFIDENTIAL" ? "default" : "secondary"}>
            {client.clientType.toLowerCase()}
          </Badge>
        </div>
        <div className="text-sm text-muted-foreground">
          <p className="font-semibold text-foreground">{activeTenant.name}</p>
          <p className="font-mono text-xs">{activeTenant.id}</p>
        </div>
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>OAuth parameters</CardTitle>
            <CardDescription>Copy issuer metadata for relying parties.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-8">
            <section className="space-y-4" data-testid="oauth-required">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-semibold text-foreground">Required</p>
                  <p className="text-xs text-muted-foreground">Include these in every integration.</p>
                </div>
                <CopyBundleButton
                  items={requiredParameters}
                  label="Copy bundle"
                  ariaLabel="Copy required OAuth parameters"
                  testId="oauth-copy-required-btn"
                />
              </div>
              <div className="space-y-3">
                {requiredParameters.map((item) => (
                  <CopyField key={item.label} label={item.label} value={item.value} />
                ))}
                {client.clientType === "CONFIDENTIAL" ? (
                  <RotateSecretForm clientId={client.id} />
                ) : (
                  <p className="text-xs text-muted-foreground">Public clients rely on PKCE and do not store secrets.</p>
                )}
              </div>
            </section>
            <section className="space-y-4" data-testid="oauth-optional">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-semibold text-foreground">Optional</p>
                  <p className="text-xs text-muted-foreground">Provide when the relying party needs extra context.</p>
                </div>
                <CopyBundleButton
                  items={optionalParameters}
                  label="Copy bundle"
                  ariaLabel="Copy optional OAuth parameters"
                  testId="oauth-copy-optional-btn"
                />
              </div>
              <div className="space-y-3">
                {optionalParameters.map((item) => (
                  <CopyField key={item.label} label={item.label} value={item.value} />
                ))}
              </div>
            </section>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Metadata</CardTitle>
            <CardDescription>Review grant configuration for audits.</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-3 text-sm text-muted-foreground">
              <MetadataRow label="Created" value={format(client.createdAt, "PPPp")} />
              <MetadataRow label="Updated" value={format(client.updatedAt, "PPPp")} />
              <MetadataRow label="Grant types" value={client.allowedGrantTypes.join(", ")} />
              <MetadataRow label="Response types" value={client.allowedResponseTypes.join(", ")} />
              <MetadataRow label="Token auth" value={client.tokenEndpointAuthMethod} />
              <MetadataRow label="PKCE required" value={client.pkceRequired ? "Yes" : "No"} />
            </dl>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Redirect URIs</CardTitle>
          <CardDescription>Whitelist trusted callback URLs. Wildcards follow Mockauth rules.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <AddRedirectForm clientId={client.id} />
          {client.redirectUris.length === 0 ? (
            <p className="text-sm text-muted-foreground">No redirect URIs configured yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>URI</TableHead>
                  <TableHead className="hidden sm:table-cell">Type</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {client.redirectUris.map((uri) => (
                  <TableRow key={uri.id}>
                    <TableCell>
                      <p className="font-mono text-sm">{uri.uri}</p>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell text-xs uppercase text-muted-foreground">{uri.type.toLowerCase()}</TableCell>
                    <TableCell className="text-right">
                      <DeleteRedirectButton redirectId={uri.id} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

const MetadataRow = ({ label, value }: { label: string; value: string }) => (
  <div className="flex items-center justify-between gap-4">
    <span>{label}</span>
    <span className="text-foreground">{value}</span>
  </div>
);

const buildOidcUrls = (origin: string, tenantId: string) => {
  const base = `${origin}/t/${tenantId}/oidc`;
  return {
    issuer: base,
    discovery: `${base}/.well-known/openid-configuration`,
    jwks: `${base}/jwks.json`,
    authorize: `${base}/authorize`,
    token: `${base}/token`,
    userinfo: `${base}/userinfo`,
  };
};
