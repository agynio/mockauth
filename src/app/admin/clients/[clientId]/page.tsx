import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { format } from "date-fns";

import { CopyBundleButton, CopyField } from "@/app/admin/_components/copy-field";
import {
  AddRedirectForm,
  DeleteRedirectButton,
  RotateSecretForm,
  UpdateAuthStrategiesForm,
  UpdateClientSigningAlgorithmsForm,
  UpdateClientScopesForm,
  UpdateClientReauthTtlForm,
  UpdateClientIssuerForm,
  UpdateClientNameForm,
  UpdateProxyProviderConfigForm,
} from "@/app/admin/clients/[clientId]/client-forms";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { authOptions } from "@/server/auth/options";
import { getAdminTenantContext } from "@/server/services/admin-tenant-context";
import { getClientByIdForTenant } from "@/server/services/client-service";
import { listApiResources } from "@/server/services/api-resource-service";
import { getRequestOrigin } from "@/server/utils/request-origin";
import { buildOidcUrls } from "@/server/oidc/url-builder";
import { parseClientAuthStrategies } from "@/server/oidc/auth-strategy";
import { decrypt } from "@/server/crypto/key-vault";

type PageParams = Promise<{ clientId: string }>;

export default async function ClientDetailPage({ params }: { params: PageParams }) {
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

  const resources = await listApiResources(activeTenant.id);

  const viewerRole = activeMembership?.role ?? "READER";
  const canManageClients = viewerRole === "OWNER" || viewerRole === "WRITER";
  const defaultResourceId = activeTenant.defaultApiResourceId!;
  const clientUsesDefault = !client.apiResourceId;
  const currentResourceId = client.apiResourceId ?? defaultResourceId;
  const storedClientResourceId = client.apiResourceId;
  const defaultResource = resources.find((resource) => resource.id === defaultResourceId);
  const currentResourceName = client.apiResource?.name ?? defaultResource?.name ?? "Default resource";
  const issuerOptions = resources
    .filter((resource) => resource.id !== defaultResourceId)
    .map((resource) => ({ id: resource.id, label: resource.name }));
  const authStrategies = parseClientAuthStrategies(client.authStrategies);
  const clientSecretValue = (() => {
    if (client.clientType !== "CONFIDENTIAL" || !client.clientSecretEncrypted) {
      return null;
    }
    try {
      return decrypt(client.clientSecretEncrypted);
    } catch (error) {
      console.error("Unable to decrypt client secret", error);
      return null;
    }
  })();

  const proxyConfigInitial = (() => {
    if (client.oauthClientMode !== "proxy" || !client.proxyConfig) {
      return null;
    }
    const rawMapping = client.proxyConfig.scopeMapping as unknown;
    const parsedMapping: Record<string, string[]> = {};
    if (rawMapping && typeof rawMapping === "object" && !Array.isArray(rawMapping)) {
      for (const [key, value] of Object.entries(rawMapping as Record<string, unknown>)) {
        const normalizedKey = key.trim();
        if (!normalizedKey) {
          continue;
        }
        const scopeValues = Array.isArray(value)
          ? value.map((scope) => `${scope}`.trim()).filter((scope) => scope.length > 0)
          : typeof value === "string"
            ? value
                .split(/\s+/)
                .map((scope) => scope.trim())
                .filter((scope) => scope.length > 0)
            : [];
        if (scopeValues.length > 0) {
          parsedMapping[normalizedKey] = scopeValues;
        }
      }
    }

    return {
      providerType: client.proxyConfig.providerType,
      authorizationEndpoint: client.proxyConfig.authorizationEndpoint,
      tokenEndpoint: client.proxyConfig.tokenEndpoint,
      userinfoEndpoint: client.proxyConfig.userinfoEndpoint,
      jwksUri: client.proxyConfig.jwksUri,
      upstreamClientId: client.proxyConfig.upstreamClientId,
      upstreamTokenEndpointAuthMethod: client.proxyConfig.upstreamTokenEndpointAuthMethod,
      defaultScopes: client.proxyConfig.defaultScopes ?? [],
      scopeMapping: parsedMapping,
      pkceSupported: client.proxyConfig.pkceSupported,
      oidcEnabled: client.proxyConfig.oidcEnabled,
      promptPassthroughEnabled: client.proxyConfig.promptPassthroughEnabled,
      loginHintPassthroughEnabled: client.proxyConfig.loginHintPassthroughEnabled,
      passthroughTokenResponse: client.proxyConfig.passthroughTokenResponse,
    };
  })();

  const origin = await getRequestOrigin();
  const urls = buildOidcUrls(origin, currentResourceId);
  const providerRedirectUri =
    client.oauthClientMode === "proxy"
      ? new URL(`/r/${currentResourceId}/oidc/proxy/callback`, origin).toString()
      : null;
  const showLocalClientSettings = client.oauthClientMode !== "proxy";
  const testFlowHref = `/admin/clients/${client.id}/test`;
  type FieldDefinition = { label: string; value: string; testId?: string };
  const tenantField: FieldDefinition = { label: "Tenant ID", value: activeTenant.id, testId: "oauth-field-tenant-id" };
  const clientIdField: FieldDefinition = { label: "Client ID", value: client.clientId, testId: "oauth-field-client-id" };
  const secretField: FieldDefinition | null = clientSecretValue
    ? { label: "Client secret", value: clientSecretValue, testId: "oauth-field-client-secret" }
    : null;
  const protocolFields: FieldDefinition[] = [
    { label: "Issuer", value: urls.issuer, testId: "oauth-field-issuer" },
    { label: "Authorization endpoint", value: urls.authorize, testId: "oauth-field-authorization" },
    { label: "Token endpoint", value: urls.token, testId: "oauth-field-token" },
  ];
  const optionalFields: FieldDefinition[] = [
    { label: "Discovery (.well-known)", value: urls.discovery, testId: "oauth-field-discovery" },
    { label: "JWKS", value: urls.jwks, testId: "oauth-field-jwks" },
    { label: "Userinfo", value: urls.userinfo, testId: "oauth-field-userinfo" },
  ];
  const requiredBundleItems = [tenantField, clientIdField, ...(secretField ? [secretField] : []), ...protocolFields].map(
    ({ label, value }) => ({ label, value }),
  );

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-3">
          <Button asChild variant="ghost" size="sm">
            <Link href="/admin/clients">← Back to clients</Link>
          </Button>
          <UpdateClientNameForm clientId={client.id} initialName={client.name} canEdit={canManageClients} />
          {!canManageClients && <p className="text-xs text-muted-foreground">Read-only access.</p>}
          <div className="flex flex-wrap gap-2">
            <Badge variant={client.clientType === "CONFIDENTIAL" ? "default" : "secondary"}>
              {client.clientType.toLowerCase()}
            </Badge>
            <Badge variant={client.oauthClientMode === "proxy" ? "default" : "outline"}>
              {client.oauthClientMode === "proxy" ? "proxy mode" : "regular mode"}
            </Badge>
          </div>
        </div>
        <div className="text-sm text-muted-foreground">
          <p className="font-semibold text-foreground">{activeTenant.name}</p>
          <p className="font-mono text-xs">{activeTenant.id}</p>
        </div>
      </div>

      <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <CardTitle>OAuth parameters</CardTitle>
            <CardDescription>Copy issuer metadata for relying parties. Currently issuing for {currentResourceName}.</CardDescription>
            </div>
            <Button asChild variant="outline" size="sm" data-testid="test-oauth-link">
              <Link href={testFlowHref}>Test OAuth</Link>
            </Button>
          </CardHeader>
          <CardContent className="space-y-8">
            <section className="space-y-4" data-testid="oauth-required">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-semibold text-foreground">Required</p>
                  <p className="text-xs text-muted-foreground">Include these in every integration.</p>
                </div>
                <CopyBundleButton
                  items={requiredBundleItems}
                  label="Copy bundle"
                  ariaLabel="Copy required OAuth parameters"
                  testId="oauth-copy-required-btn"
                />
              </div>
              <div className="space-y-3">
                <CopyField key={tenantField.label} label={tenantField.label} value={tenantField.value} testId={tenantField.testId} />
                <CopyField key={clientIdField.label} label={clientIdField.label} value={clientIdField.value} testId={clientIdField.testId} />
                {client.clientType === "CONFIDENTIAL" ? (
                  <div className="space-y-3">
                    {secretField ? (
                      <CopyField
                        key={secretField.label}
                        label={secretField.label}
                        value={secretField.value}
                        testId={secretField.testId}
                        description="Treat as confidential; rotate when compromised."
                      />
                    ) : (
                      <p className="text-xs text-muted-foreground">Rotate the client to generate a new secret.</p>
                    )}
                    <RotateSecretForm clientId={client.id} canRotate={canManageClients} />
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">Public clients rely on PKCE and do not store secrets.</p>
                )}
                {protocolFields.map((item) => (
                  <CopyField key={item.label} label={item.label} value={item.value} testId={item.testId} />
                ))}
              </div>
            </section>
            <section className="space-y-4" data-testid="oauth-optional">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-semibold text-foreground">Optional</p>
                  <p className="text-xs text-muted-foreground">Provide when the relying party needs extra context.</p>
                </div>
                <CopyBundleButton
                  items={optionalFields}
                  label="Copy bundle"
                  ariaLabel="Copy optional OAuth parameters"
                  testId="oauth-copy-optional-btn"
                />
              </div>
              <div className="space-y-3">
                {optionalFields.map((item) => (
                  <CopyField key={item.label} label={item.label} value={item.value} testId={item.testId} />
                ))}
              </div>
            </section>
          </CardContent>
        </Card>

      <Card>
        <CardHeader>
          <CardTitle>Issuer / API resource</CardTitle>
          <CardDescription>Choose which API resource this client uses for discovery and tokens.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <UpdateClientIssuerForm
            clientId={client.id}
            canEdit={canManageClients}
            defaultResourceId={defaultResourceId}
            defaultResourceName={defaultResource?.name ?? "Default resource"}
            currentResourceId={storedClientResourceId}
            usesDefault={clientUsesDefault}
            resources={issuerOptions}
          />
          <p className="text-xs text-muted-foreground">
            Selecting the default keeps this client aligned with tenant-level issuer changes.
          </p>
        </CardContent>
      </Card>

      {client.oauthClientMode === "proxy" && proxyConfigInitial ? (
        <Card>
          <CardHeader>
            <CardTitle>Proxy provider</CardTitle>
            <CardDescription>
              Configure the upstream identity provider used to broker OAuth flows.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {providerRedirectUri ? (
              <CopyField label="Provider redirect URI" value={providerRedirectUri} testId="provider-redirect-uri" />
            ) : null}
            <Alert data-testid="proxy-mode-note">
              <AlertTitle>Scopes and claims come from upstream</AlertTitle>
              <AlertDescription>
                MockAuth will forward tokens from the provider as-is. Local scope toggles and token settings are disabled in
                proxy mode.
              </AlertDescription>
            </Alert>
            <UpdateProxyProviderConfigForm
              clientId={client.id}
              canEdit={canManageClients}
              initialConfig={proxyConfigInitial}
            />
          </CardContent>
        </Card>
      ) : null}

      {showLocalClientSettings ? (
        <Card data-testid="client-scopes-card">
          <CardHeader>
            <CardTitle>Scopes</CardTitle>
            <CardDescription>Toggle which scopes this client can request.</CardDescription>
          </CardHeader>
          <CardContent>
            <UpdateClientScopesForm
              clientId={client.id}
              canEdit={canManageClients}
              initialScopes={client.allowedScopes}
            />
          </CardContent>
        </Card>
      ) : null}

      {showLocalClientSettings ? (
        <Card data-testid="client-auth-strategies-card">
          <CardHeader>
            <CardTitle>Auth strategies</CardTitle>
            <CardDescription>Enable username or email flows and decide how the OIDC subject is derived.</CardDescription>
          </CardHeader>
          <CardContent>
            <UpdateAuthStrategiesForm
              clientId={client.id}
              canEdit={canManageClients}
              initialStrategies={authStrategies}
            />
          </CardContent>
        </Card>
      ) : null}

      {showLocalClientSettings ? (
        <Card data-testid="client-signing-card">
          <CardHeader>
            <CardTitle>Signing algorithms</CardTitle>
            <CardDescription>Configure how Mockauth signs ID tokens and access tokens.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <UpdateClientSigningAlgorithmsForm
              clientId={client.id}
              canEdit={canManageClients}
              initialIdTokenAlg={client.idTokenSignedResponseAlg}
              initialAccessTokenAlg={client.accessTokenSigningAlg}
            />
            <p className="text-xs text-muted-foreground">
              Each algorithm maintains its own active signing key. Mockauth rotates keys on demand when you switch algorithms.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {showLocalClientSettings ? (
        <Card data-testid="client-reauth-card">
          <CardHeader>
            <CardTitle>Re-authentication</CardTitle>
            <CardDescription>Control how long Mockauth honors a previous sign-in for this client.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <UpdateClientReauthTtlForm
              clientId={client.id}
              initialTtl={client.reauthTtlSeconds}
              canEdit={canManageClients}
            />
            <p className="text-xs text-muted-foreground">
              0 seconds disables silent reuse. Higher values allow the authorize endpoint to skip the login form when the same admin signs in again within the TTL window.
            </p>
          </CardContent>
        </Card>
      ) : null}

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
          <AddRedirectForm clientId={client.id} canEdit={canManageClients} />
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
                      <DeleteRedirectButton redirectId={uri.id} canEdit={canManageClients} />
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
