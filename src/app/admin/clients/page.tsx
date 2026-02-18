import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { formatDistanceToNow } from "date-fns";

import { ClientSearchInput } from "@/app/admin/clients/client-search-input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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
      <header className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-sm uppercase tracking-wide text-muted-foreground">Tenant · {activeTenant.name}</p>
          <h1 className="text-3xl font-semibold tracking-tight">OAuth clients</h1>
          <p className="text-sm text-muted-foreground">Manage relying parties and their credentials.</p>
        </div>
        <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-end lg:w-auto">
          <div className="w-full sm:max-w-xs lg:w-72">
            <ClientSearchInput initialQuery={query} />
            <p className="mt-1 text-xs text-muted-foreground">Filters apply automatically.</p>
          </div>
          <Button asChild>
            <Link href="/admin/clients/new">Add client</Link>
          </Button>
        </div>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Clients</CardTitle>
          <CardDescription>
            {result.clients.length === 0
              ? "No clients yet. Create one to begin an OIDC flow."
              : `${result.total} total · showing ${result.clients.length}`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {result.clients.length === 0 ? (
            <EmptyClientsState hasQuery={Boolean(query)} query={query} />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Client</TableHead>
                  <TableHead className="hidden sm:table-cell">Type</TableHead>
                  <TableHead className="hidden md:table-cell">Redirects</TableHead>
                  <TableHead className="hidden md:table-cell">Updated</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.clients.map((client) => (
                  <TableRow key={client.id}>
                    <TableCell>
                      <div className="space-y-1">
                        <p className="font-medium">{client.name}</p>
                        <p className="font-mono text-xs text-muted-foreground">{client.clientId}</p>
                      </div>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <Badge variant={client.clientType === "CONFIDENTIAL" ? "default" : "secondary"}>
                        {client.clientType.toLowerCase()}
                      </Badge>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {client._count.redirectUris} redirect URI{client._count.redirectUris === 1 ? "" : "s"}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {formatDistanceToNow(client.updatedAt, { addSuffix: true })}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button asChild variant="ghost" size="sm">
                        <Link href={`/admin/clients/${client.id}`}>Details →</Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {totalPages > 1 ? <PaginationControls query={query} page={page} totalPages={totalPages} /> : null}
    </div>
  );
}

const EmptyClientsState = ({ hasQuery, query }: { hasQuery: boolean; query: string }) => (
  <div className="rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">
    {hasQuery ? (
      <p>
        No clients match <span className="font-semibold">“{query}”</span>.
      </p>
    ) : (
      <p>No clients yet. Create one to start an OIDC flow.</p>
    )}
  </div>
);

const NoTenantState = () => (
  <Card className="border-dashed">
    <CardHeader className="text-center">
      <CardTitle>No tenants yet</CardTitle>
      <CardDescription>Create or activate a tenant from the sidebar to manage clients.</CardDescription>
    </CardHeader>
  </Card>
);

const PaginationControls = ({ query, page, totalPages }: { query: string; page: number; totalPages: number }) => {
  const prevDisabled = page <= 1;
  const nextDisabled = page >= totalPages;
  const prevHref = prevDisabled ? "#" : buildPageLink(query, page - 1);
  const nextHref = nextDisabled ? "#" : buildPageLink(query, page + 1);

  return (
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border bg-card px-4 py-3">
      {prevDisabled ? (
        <Button variant="outline" disabled>
          ← Previous
        </Button>
      ) : (
        <Button asChild variant="outline">
          <Link href={prevHref}>← Previous</Link>
        </Button>
      )}
      <span className="text-sm text-muted-foreground">
        Page {page} / {totalPages}
      </span>
      {nextDisabled ? (
        <Button variant="outline" disabled>
          Next →
        </Button>
      ) : (
        <Button asChild variant="outline">
          <Link href={nextHref}>Next →</Link>
        </Button>
      )}
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
