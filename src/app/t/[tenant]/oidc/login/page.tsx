import Link from "next/link";

import { getActiveTenantBySlug } from "@/server/services/tenant-service";

type LoginPageProps = {
  params: Promise<{ tenant: string }>;
  searchParams?: Promise<{ return_to?: string }>;
};

export default async function TenantLoginPage({ params, searchParams }: LoginPageProps) {
  const { tenant: tenantSlug } = await params;
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const tenant = await getActiveTenantBySlug(tenantSlug);
  const returnTo = resolvedSearchParams?.return_to ?? `/t/${tenantSlug}/oidc/authorize`;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center px-4">
      <div className="w-full max-w-md rounded-xl border border-slate-800 bg-slate-900/60 p-8 shadow-2xl">
        <h1 className="text-2xl font-semibold mb-2">Log in to {tenant.name}</h1>
        <p className="text-sm text-slate-300 mb-6">
          Enter any username to simulate an end-user signing in. The session is scoped to tenant {tenant.slug}.
        </p>
        <form method="POST" action={`/t/${tenant.slug}/oidc/login/submit`} className="space-y-4">
          <input type="hidden" name="return_to" value={returnTo} />
          <label className="space-y-2 block text-sm">
            <span className="text-slate-200">Username</span>
            <input
              type="text"
              name="username"
              required
              className="w-full rounded-lg border border-slate-700 bg-slate-950/40 px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-amber-400"
              placeholder="qa-user"
            />
          </label>
          <button
            type="submit"
            className="w-full rounded-lg bg-amber-400 px-4 py-2 font-semibold text-slate-950 hover:bg-amber-300"
          >
            Continue
          </button>
        </form>
        <p className="mt-4 text-xs text-slate-400">
          Need to manage tenants? Visit the <Link href="/admin" className="underline">admin console</Link>.
        </p>
      </div>
    </div>
  );
}
