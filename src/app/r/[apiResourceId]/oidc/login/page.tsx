import Link from "next/link";

import { LoginForm } from "@/app/r/[apiResourceId]/oidc/login/login-form";
import { DEFAULT_CLIENT_AUTH_STRATEGIES, parseClientAuthStrategies } from "@/server/oidc/auth-strategy";
import type { ClientAuthStrategies } from "@/server/oidc/auth-strategy";
import { getClientForTenant } from "@/server/services/client-service";
import { getApiResourceWithTenant } from "@/server/services/api-resource-service";

type LoginPageProps = {
  params: Promise<{ apiResourceId: string }>;
  searchParams?: Promise<{ return_to?: string }>;
};

export default async function TenantLoginPage({ params, searchParams }: LoginPageProps) {
  const { apiResourceId } = await params;
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const { tenant, resource } = await getApiResourceWithTenant(apiResourceId);
  const fallbackReturnTo = `/r/${resource.id}/oidc/authorize`;
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
    <div className="flex min-h-screen items-center justify-center bg-surface-0 px-4 text-foreground">
      <div className="w-full max-w-md rounded-2xl border border-border bg-surface-1/90 p-8 shadow-2xl">
        <h1 className="mb-2 text-2xl font-semibold">Log in to {tenant.name}</h1>
        <p className="mb-6 text-sm text-muted-foreground">
          Enter any {strategySummary} to simulate an end-user signing in. The session is scoped to tenant {tenant.id}.
        </p>
        <LoginForm apiResourceId={apiResourceId} returnTo={returnTo} strategies={strategies} />
        <p className="mt-4 text-xs text-muted-foreground">
          Need to manage tenants? Visit the{" "}
          <Link
            href="/admin"
            className="font-semibold text-brand-400 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            admin console
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
