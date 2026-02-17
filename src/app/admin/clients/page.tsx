import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { formatDistanceToNow } from "date-fns";

import { authOptions } from "@/server/auth/options";
import { getAdminTenantContext } from "@/server/services/admin-tenant-context";
import { listClients } from "@/server/services/client-service";

type SearchParams = Promise<{ q?: string; page?: string }>;

const PAGE_SIZE = 10;

export default async function ClientsPage({ searchParams }: { searchParams: SearchParams }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    redirect("/api/auth/signin");
  }

  const resolved = await searchParams;
  const query = typeof resolved?.q === "string" ? resolved.q.trim() : "";
  const pageParam = typeof resolved?.page === "string" ? Number.parseInt(resolved.page, 10) : 1;
  const page = Number.isNaN(pageParam) ? 1 : Math.max(1, pageParam);

  const { activeTenant } = await getAdminTenantContext(session.user.id);

  if (!activeTenant) {
    return <NoTenantState />;
  }

  const result = await listClients(activeTenant.id, {
    search: query || undefined,
    page,
    pageSize: PAGE_SIZE,
  });

  const totalPages = Math.max(1, Math.ceil(result.total / result.pageSize));

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <p className="text-sm uppercase tracking-wider text-slate-400">Tenant</p>
        <h1 className="text-3xl font-semibold text-white">{activeTenant.name}</h1>
        <p className="text-sm text-slate-400">Manage OAuth clients scoped to this tenant.</p>
      </header>

      <div className="flex flex-col gap-3 rounded-2xl border border-white/5 bg-slate-950/40 p-6 shadow-lg shadow-slate-950/50 lg:flex-row lg:items-center">
        <form className="flex w-full flex-1 gap-3" action="/admin/clients">
          <input
            type="text"
            name="q"
            defaultValue={query}
            placeholder="Search by name or client_id"
            className="flex-1 rounded-xl border border-white/10 bg-slate-900/70 px-4 py-2 text-sm text-white placeholder:text-slate-500"
          />
          <button type="submit" className="rounded-xl bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700">
            Search
          </button>
        </form>
        <Link
          href="/admin/clients/new"
          className="inline-flex items-center justify-center rounded-xl bg-amber-400 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-amber-300"
        >
          Add client
        </Link>
      </div>

      <section className="space-y-4">
        {result.clients.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/10 bg-slate-900/40 p-10 text-center text-slate-400">
            {query ? (
              <p>
                No clients match <span className="text-white">“{query}”</span>.
              </p>
            ) : (
              <p>No clients yet. Create one to start an OIDC flow.</p>
            )}
          </div>
        ) : (
          <ul className="grid gap-4 md:grid-cols-2">
            {result.clients.map((client) => (
              <li key={client.id} className="rounded-2xl border border-white/5 bg-slate-900/40 p-5">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-lg font-semibold text-white">{client.name}</p>
                    <p className="text-xs font-mono text-slate-400">{client.clientId}</p>
                  </div>
                  <span className="rounded-full border border-amber-300/40 bg-amber-300/10 px-3 py-1 text-xs uppercase tracking-wide text-amber-200">
                    {client.clientType.toLowerCase()}
                  </span>
                </div>
                <div className="mt-4 flex items-center justify-between text-xs text-slate-400">
                  <span>
                    {client._count.redirectUris} redirect URI{client._count.redirectUris === 1 ? "" : "s"}
                  </span>
                  <span>
                    Updated {formatDistanceToNow(client.updatedAt, { addSuffix: true })}
                  </span>
                </div>
                <Link
                  href={`/admin/clients/${client.id}`}
                  className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-amber-300 hover:text-amber-200"
                >
                  View details
                  <span aria-hidden>→</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {totalPages > 1 && (
        <PaginationControls query={query} page={page} totalPages={totalPages} />
      )}
    </div>
  );
}

const NoTenantState = () => (
  <div className="space-y-4 rounded-2xl border border-dashed border-white/10 bg-slate-900/40 p-10 text-center">
    <h2 className="text-2xl font-semibold text-white">No tenants yet</h2>
    <p className="text-sm text-slate-400">Add a tenant from the sidebar to begin managing clients.</p>
  </div>
);

const PaginationControls = ({ query, page, totalPages }: { query: string; page: number; totalPages: number }) => {
  const prevDisabled = page <= 1;
  const nextDisabled = page >= totalPages;
  const prevHref = prevDisabled ? "#" : buildPageLink(query, page - 1);
  const nextHref = nextDisabled ? "#" : buildPageLink(query, page + 1);

  return (
    <div className="flex items-center justify-between rounded-2xl border border-white/5 bg-slate-900/40 px-4 py-3 text-sm text-white">
      <a
        href={prevHref}
        aria-disabled={prevDisabled}
        className={`rounded-lg px-3 py-2 ${prevDisabled ? "pointer-events-none text-slate-500" : "hover:text-amber-200"}`}
      >
        ← Previous
      </a>
      <span className="text-xs uppercase tracking-wide text-slate-400">
        Page {page} / {totalPages}
      </span>
      <a
        href={nextHref}
        aria-disabled={nextDisabled}
        className={`rounded-lg px-3 py-2 ${nextDisabled ? "pointer-events-none text-slate-500" : "hover:text-amber-200"}`}
      >
        Next →
      </a>
    </div>
  );
};

const buildPageLink = (query: string, page: number) => {
  const params = new URLSearchParams();
  if (query) {
    params.set("q", query);
  }
  if (page > 1) {
    params.set("page", String(page));
  }
  const qs = params.toString();
  return qs ? `/admin/clients?${qs}` : "/admin/clients";
};
