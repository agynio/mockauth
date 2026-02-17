import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";

import { authOptions } from "@/server/auth/options";
import { getAdminTenantContext } from "@/server/services/admin-tenant-context";
import { NewClientForm } from "@/app/admin/clients/new/client-form";

export default async function NewClientPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    redirect("/api/auth/signin");
  }

  const { activeTenant } = await getAdminTenantContext(session.user.id);

  if (!activeTenant) {
    return (
      <div className="space-y-4 rounded-2xl border border-dashed border-white/10 bg-slate-900/40 p-10 text-center">
        <h1 className="text-2xl font-semibold text-white">Select a tenant</h1>
        <p className="text-sm text-slate-400">Use the sidebar to create or activate a tenant before creating clients.</p>
        <Link href="/admin/clients" className="inline-flex items-center justify-center rounded-xl bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700">
          Back to clients list
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <Link href="/admin/clients" className="text-sm text-slate-400 hover:text-amber-200">
          ← Back to clients
        </Link>
        <h1 className="text-3xl font-semibold text-white">New client</h1>
        <p className="text-sm text-slate-400">Tenant: {activeTenant.name}</p>
      </div>
      <div className="rounded-2xl border border-white/10 bg-slate-950/50 p-6 shadow-lg shadow-slate-950/50">
        <NewClientForm tenantId={activeTenant.id} />
      </div>
    </div>
  );
}
