import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { format } from "date-fns";

import { CopyField } from "@/app/admin/_components/copy-field";
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
        <section className="space-y-4 rounded-2xl border border-white/10 bg-slate-950/60 p-6">
          <h2 className="text-lg font-semibold text-white">Credentials</h2>
          <CopyField label="Client ID" value={client.clientId} />
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
