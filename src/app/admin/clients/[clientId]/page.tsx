import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
import { getServerSession } from "next-auth";
import { format } from "date-fns";

import { CopyBundleButton, CopyField } from "@/app/admin/_components/copy-field";
import { AddRedirectForm, DeleteRedirectButton, RotateSecretForm, UpdateClientNameForm } from "@/app/admin/clients/[clientId]/client-forms";
import { authOptions } from "@/server/auth/options";
import { getAdminTenantContext } from "@/server/services/admin-tenant-context";
import { getClientByIdForTenant } from "@/server/services/client-service";

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

  const origin = await resolveRequestOrigin();
  const urls = buildOidcUrls(origin, activeTenant.id);
  const parameterItems = [
    { label: "Tenant ID", value: activeTenant.id },
    { label: "Issuer", value: urls.issuer },
    { label: "Discovery (.well-known)", value: urls.discovery },
    { label: "JWKS", value: urls.jwks },
    { label: "Authorize endpoint", value: urls.authorize },
    { label: "Token endpoint", value: urls.token },
    { label: "Userinfo endpoint", value: urls.userinfo },
    { label: "Client ID", value: client.clientId },
  ];

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <Link href="/admin/clients" className="text-sm text-slate-400 hover:text-amber-200">
          ← Back to clients
        </Link>
        <p className="text-xs uppercase tracking-wide text-slate-400">Tenant: {activeTenant.name}</p>
        <UpdateClientNameForm clientId={client.id} initialName={client.name} />
        <span className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs uppercase tracking-wide text-white">
          {client.clientType.toLowerCase()}
        </span>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="space-y-5 rounded-2xl border border-white/10 bg-slate-950/60 p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-white">OAuth parameters</h2>
              <p className="text-sm text-slate-400">Copy endpoints and IDs for configuring relying parties.</p>
            </div>
            <CopyBundleButton
              items={parameterItems.map((item) => ({ label: item.label, value: item.value }))}
              label="Copy all"
            />
          </div>
          <div className="space-y-3">
            {parameterItems.map((item) => (
              <CopyField key={item.label} label={item.label} value={item.value} />
            ))}
          </div>
          {client.clientType === "CONFIDENTIAL" ? (
            <div className="rounded-xl border border-amber-300/40 bg-amber-300/5 p-4">
              <RotateSecretForm clientId={client.id} />
            </div>
          ) : (
            <p className="text-sm text-slate-400">Public clients rely on PKCE and do not store secrets.</p>
          )}
        </section>

        <section className="space-y-4 rounded-2xl border border-white/10 bg-slate-950/60 p-6">
          <h2 className="text-lg font-semibold text-white">Metadata</h2>
          <dl className="grid gap-3 text-sm text-slate-300">
            <MetadataRow label="Created at" value={format(client.createdAt, "PPPp")} />
            <MetadataRow label="Updated" value={format(client.updatedAt, "PPPp")} />
            <MetadataRow label="Grant types" value={client.allowedGrantTypes.join(", ")} />
            <MetadataRow label="Response types" value={client.allowedResponseTypes.join(", ")} />
            <MetadataRow label="Token endpoint auth" value={client.tokenEndpointAuthMethod} />
            <MetadataRow label="PKCE required" value={client.pkceRequired ? "Yes" : "No"} />
          </dl>
        </section>
      </div>

      <section className="space-y-4 rounded-2xl border border-white/10 bg-slate-950/60 p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white">Redirect URIs</h2>
            <p className="text-sm text-slate-400">Whitelist trusted callback URLs. Wildcards follow Mockauth rules.</p>
          </div>
        </div>
        <AddRedirectForm clientId={client.id} />
        {client.redirectUris.length === 0 ? (
          <p className="text-sm text-slate-400">No redirect URIs configured yet.</p>
        ) : (
          <ul className="space-y-3">
            {client.redirectUris.map((uri) => (
              <li key={uri.id} className="flex flex-col gap-2 rounded-xl border border-white/10 bg-slate-900/40 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-mono text-sm text-white">{uri.uri}</p>
                  <p className="text-xs uppercase tracking-wide text-slate-400">{uri.type.toLowerCase()}</p>
                </div>
                <DeleteRedirectButton redirectId={uri.id} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

const MetadataRow = ({ label, value }: { label: string; value: string }) => (
  <div className="flex items-center justify-between">
    <span className="text-slate-500">{label}</span>
    <span className="text-white">{value}</span>
  </div>
);

const resolveRequestOrigin = async () => {
  const headerList = await headers();
  const forwardedHost = headerList.get("x-forwarded-host") ?? headerList.get("host");
  const proto = headerList.get("x-forwarded-proto") ?? "https";
  if (forwardedHost) {
    const host = forwardedHost.split(",")[0]?.trim();
    if (host) {
      return `${proto}://${host}`;
    }
  }

  const fallback = process.env.NEXTAUTH_URL;
  if (fallback) {
    try {
      return new URL(fallback).origin;
    } catch {}
  }
  return "http://localhost:3000";
};

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
