import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";

import { Prisma } from "@/generated/prisma";
import { CreateClientForm, CreateMockUserForm, CreateTenantForm, RotateKeyForm, AddRedirectForm, SetActiveTenantButton } from "@/app/admin/_components/forms";
import { authOptions } from "@/server/auth/options";
import { prisma } from "@/server/db/client";
import { getTenantMemberships } from "@/server/services/tenant-service";

const tenantDetailInclude = {
  clients: { include: { redirectUris: true }, orderBy: { createdAt: "desc" } },
  keys: { orderBy: { createdAt: "desc" } },
  mockUsers: { orderBy: { createdAt: "desc" } },
} satisfies Prisma.TenantInclude;

type DetailedTenant = Prisma.TenantGetPayload<{ include: typeof tenantDetailInclude }>;

export default async function AdminPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    redirect("/api/auth/signin");
  }

  const memberships = await getTenantMemberships(session.user.id);
  const cookieStore = await cookies();
  const cookieSlug = cookieStore.get("admin_active_tenant")?.value;
  const activeSlug = memberships.find((m) => m.tenant.slug === cookieSlug)?.tenant.slug ?? memberships[0]?.tenant.slug ?? null;
  const activeTenant: DetailedTenant | null = activeSlug
    ? await prisma.tenant.findUnique({
        where: { slug: activeSlug },
        include: tenantDetailInclude,
      })
    : null;

  return (
    <div className="space-y-8">
      <section className="rounded-xl border border-slate-800 bg-slate-950/40 p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
          <div className="lg:w-1/2">
            <h2 className="text-xl font-semibold text-white">Tenants</h2>
            <p className="text-sm text-slate-300">Create tenants and switch the active context for management.</p>
            <ul className="mt-4 space-y-3">
              {memberships.map((membership) => (
                <li key={membership.tenantId} className={`rounded-lg border px-3 py-2 ${membership.tenant.slug === activeSlug ? 'border-amber-400 bg-amber-400/10' : 'border-slate-800'}`}>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-white">{membership.tenant.name}</p>
                      <p className="text-xs text-slate-400">/{membership.tenant.slug}</p>
                    </div>
                    {membership.tenant.slug !== activeSlug && <SetActiveTenantButton slug={membership.tenant.slug} />}
                  </div>
                </li>
              ))}
              {memberships.length === 0 && <li className="text-sm text-slate-400">No tenants yet.</li>}
            </ul>
          </div>
          <div className="lg:w-1/2">
            <h3 className="font-semibold text-white">Create tenant</h3>
            <CreateTenantForm />
          </div>
        </div>
      </section>

      {activeTenant && (
        <section className="space-y-6">
          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold text-white">{activeTenant.name}</h2>
                <p className="text-sm text-slate-400">slug: {activeTenant.slug}</p>
              </div>
              <RotateKeyForm tenantId={activeTenant.id} />
            </div>
            <div className="mt-4 grid gap-6 lg:grid-cols-2">
              <div>
                <h3 className="font-semibold text-slate-200">Clients</h3>
                <CreateClientForm tenantId={activeTenant.id} />
                <div className="mt-4 space-y-4">
                  {activeTenant.clients.map((client) => (
                    <div key={client.id} className="rounded-lg border border-slate-800 p-4">
                      <p className="font-semibold text-white">{client.name}</p>
                      <p className="text-xs text-slate-400">{client.clientId}</p>
                      <div className="mt-2 space-y-1 text-xs text-slate-300">
                        {client.redirectUris.map((redirect) => (
                          <p key={redirect.id}>{redirect.uri} <span className="text-slate-500">({redirect.type.toLowerCase()})</span></p>
                        ))}
                      </div>
                      <div className="mt-3">
                        <AddRedirectForm clientId={client.id} />
                      </div>
                    </div>
                  ))}
                  {activeTenant.clients.length === 0 && <p className="text-sm text-slate-400">No clients yet.</p>}
                </div>
              </div>
              <div className="space-y-6">
                <div className="rounded-lg border border-slate-800 p-4">
                  <h3 className="font-semibold text-slate-200">Signing keys</h3>
                  <ul className="mt-3 space-y-2 text-sm text-slate-300">
                    {activeTenant.keys.map((key) => (
                      <li key={key.id} className="flex items-center justify-between">
                        <span>{key.kid}</span>
                        <span className="text-xs uppercase text-slate-500">{key.status}</span>
                      </li>
                    ))}
                    {activeTenant.keys.length === 0 && <li>No keys yet.</li>}
                  </ul>
                </div>
                <div className="rounded-lg border border-slate-800 p-4">
                  <h3 className="font-semibold text-slate-200">Mock users</h3>
                  <CreateMockUserForm tenantId={activeTenant.id} />
                  <ul className="mt-3 space-y-1 text-sm text-slate-300">
                    {activeTenant.mockUsers.map((user) => (
                      <li key={user.id}>{user.username}</li>
                    ))}
                    {activeTenant.mockUsers.length === 0 && <li>No mock users yet.</li>}
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
