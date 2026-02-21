import Link from "next/link";

import { LoginForm } from "@/app/t/[tenantId]/r/[apiResourceId]/oidc/login/login-form";
import { DEFAULT_CLIENT_AUTH_STRATEGIES, parseClientAuthStrategies } from "@/server/oidc/auth-strategy";
import type { ClientAuthStrategies } from "@/server/oidc/auth-strategy";
import { getClientForTenant } from "@/server/services/client-service";
import { getActiveTenantById } from "@/server/services/tenant-service";

type LoginPageProps = {
  params: Promise<{ tenantId: string; apiResourceId: string }>;
  searchParams?: Promise<{ return_to?: string }>;
};

export default async function TenantLoginPage({ params, searchParams }: LoginPageProps) {
  const { tenantId, apiResourceId } = await params;
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const tenant = await getActiveTenantById(tenantId);
  const fallbackReturnTo = `/t/${tenantId}/r/${apiResourceId}/oidc/authorize`;
  const returnTo = resolvedSearchParams?.return_to ?? fallbackReturnTo;
  let strategyConfig = DEFAULT_CLIENT_AUTH_STRATEGIES;
  try {
    const authorizeUrl = new URL(returnTo, "http://localhost");
    const clientId = authorizeUrl.searchParams.get("client_id");
    if (clientId) {
      const client = await getClientForTenant(tenant.id, clientId);
      strategyConfig = parseClientAuthStrategies(client.authStrategies);
    }
  } catch {
    strategyConfig = DEFAULT_CLIENT_AUTH_STRATEGIES;
  }

  const enabledStrategies = (Object.entries(strategyConfig) as [
    keyof ClientAuthStrategies,
    ClientAuthStrategies[keyof ClientAuthStrategies],
  ][])
    .filter(([, cfg]) => cfg.enabled)
    .map(([key, cfg]) => ({
      key,
      cfg,
    }));

  if (!enabledStrategies.length) {
    enabledStrategies.push({ key: "username", cfg: DEFAULT_CLIENT_AUTH_STRATEGIES.username });
  }

  const strategies = enabledStrategies.map(({ key, cfg }) => {
    const isEmail = key === "email";
    const emailConfig = isEmail ? (cfg as ClientAuthStrategies["email"]) : null;
    return {
      key,
      title: isEmail ? "Email" : "Username",
      description: isEmail
        ? "Enter any email to simulate an email-based login."
        : "Enter any username to simulate an end-user.",
      placeholder: isEmail ? "qa-user@example.test" : "qa-user",
      subSource: cfg.subSource,
      emailVerifiedMode: emailConfig?.emailVerifiedMode,
    };
  });
  const strategySummary = strategies.map((strategy) => strategy.title.toLowerCase()).join(" or ");

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center px-4">
      <div className="w-full max-w-md rounded-xl border border-slate-800 bg-slate-900/60 p-8 shadow-2xl">
        <h1 className="text-2xl font-semibold mb-2">Log in to {tenant.name}</h1>
        <p className="text-sm text-slate-300 mb-6">
          Enter any {strategySummary} to simulate an end-user signing in. The session is scoped to tenant {tenant.id}.
        </p>
        <LoginForm tenantId={tenant.id} apiResourceId={apiResourceId} returnTo={returnTo} strategies={strategies} />
        <p className="mt-4 text-xs text-slate-400">
          Need to manage tenants? Visit the <Link href="/admin" className="underline">admin console</Link>.
        </p>
      </div>
    </div>
  );
}
