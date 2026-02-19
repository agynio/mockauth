import { redirect } from "next/navigation";

import { getActiveTenantById } from "@/server/services/tenant-service";

type LoginPageProps = {
  params: Promise<{ tenantId: string }>;
  searchParams?: Promise<{ return_to?: string }>;
};

export default async function TenantLoginRedirect({ params, searchParams }: LoginPageProps) {
  const { tenantId } = await params;
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const tenant = await getActiveTenantById(tenantId);
  const query = resolvedSearchParams?.return_to ? `?return_to=${encodeURIComponent(resolvedSearchParams.return_to)}` : "";
  redirect(`/t/${tenant.id}/r/${tenant.defaultApiResourceId}/oidc/login${query}`);
}
