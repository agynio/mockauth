import Link from "next/link";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { LoginForm } from "@/app/r/[apiResourceId]/oidc/login/login-form";
import { DEFAULT_CLIENT_AUTH_STRATEGIES, parseClientAuthStrategies } from "@/server/oidc/auth-strategy";
import type { ClientAuthStrategies } from "@/server/oidc/auth-strategy";
import {
  PROXY_AUTH_STRATEGY_METADATA,
  enabledProxyStrategies,
  parseProxyAuthStrategies,
  type ProxyAuthStrategy,
} from "@/server/oidc/proxy-auth-strategy";
import { getClientForTenant } from "@/server/services/client-service";
import { getApiResourceWithTenant } from "@/server/services/api-resource-service";

type LoginPageProps = {
  params: Promise<{ apiResourceId: string }>;
  searchParams?: Promise<{ return_to?: string }>;
};

const renderUnavailable = (message: string) => (
  <div className="flex min-h-screen items-center justify-center bg-surface-0 px-4 text-foreground">
    <div className="w-full max-w-md rounded-2xl border border-border bg-surface-1/90 p-8 text-center shadow-2xl">
      <h1 className="mb-3 text-2xl font-semibold">Sign-in unavailable</h1>
      <p className="text-sm text-muted-foreground">{message}</p>
      <Button asChild variant="ghost" size="sm" className="mt-6">
        <Link href="/">Return home</Link>
      </Button>
    </div>
  </div>
);

export default async function TenantLoginPage({ params, searchParams }: LoginPageProps) {
  const { apiResourceId } = await params;
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const { tenant, resource } = await getApiResourceWithTenant(apiResourceId);
  const fallbackReturnTo = `/r/${resource.id}/oidc/authorize`;
  const returnTo = resolvedSearchParams?.return_to ?? fallbackReturnTo;
  let strategyConfig = DEFAULT_CLIENT_AUTH_STRATEGIES;
  let proxyClient: Awaited<ReturnType<typeof getClientForTenant>> | null = null;
  let returnToUrl: URL | null = null;
  try {
    returnToUrl = new URL(returnTo, "http://localhost");
    const clientId = returnToUrl.searchParams.get("client_id");
    if (clientId) {
      const client = await getClientForTenant(tenant.id, clientId);
      if (client.oauthClientMode === "proxy") {
        proxyClient = client;
      } else {
        strategyConfig = parseClientAuthStrategies(client.authStrategies);
      }
    }
  } catch {
    strategyConfig = DEFAULT_CLIENT_AUTH_STRATEGIES;
  }

  if (proxyClient && returnToUrl) {
    const proxyStrategies = parseProxyAuthStrategies(proxyClient.proxyAuthStrategies);
    const enabledStrategies = enabledProxyStrategies(proxyStrategies);
    if (enabledStrategies.length === 0) {
      return renderUnavailable("No proxy login strategies are enabled for this client.");
    }
    if (enabledStrategies.length === 1) {
      const redirectUrl = new URL(returnToUrl.toString());
      redirectUrl.searchParams.set("proxy_strategy", enabledStrategies[0]!);
      redirect(redirectUrl.toString());
    }

    const buildStrategyUrl = (strategy: ProxyAuthStrategy) => {
      const redirectUrl = new URL(returnToUrl.toString());
      redirectUrl.searchParams.set("proxy_strategy", strategy);
      return redirectUrl.toString();
    };
    const strategySummary = enabledStrategies
      .map((strategy) => (strategy === "redirect" ? "redirect flow" : "preauthorized identities"))
      .join(" or ");
    const strategyCards = enabledStrategies.map((strategy) => {
      const metadata = PROXY_AUTH_STRATEGY_METADATA[strategy];
      const actionLabel = strategy === "redirect" ? "Continue with redirect" : "Choose a preauthorized identity";
      return {
        strategy,
        title: metadata.title,
        description: metadata.description,
        href: buildStrategyUrl(strategy),
        actionLabel,
      };
    });

    return (
      <div className="flex min-h-screen items-center justify-center bg-surface-0 px-4 text-foreground">
        <div className="w-full max-w-md space-y-6 rounded-2xl border border-border bg-surface-1/90 p-8 shadow-2xl">
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold">Choose how to sign in</h1>
            <p className="text-sm text-muted-foreground">
              Select a {strategySummary} to authorize <strong>{proxyClient.name}</strong> on tenant{" "}
              <strong>{tenant.name}</strong>.
            </p>
          </div>
          <div className="space-y-4">
            {strategyCards.map((card) => (
              <div
                key={card.strategy}
                className="space-y-3 rounded-xl border border-border bg-surface-2/70 p-4 text-sm shadow-sm"
              >
                <div className="space-y-1">
                  <p className="font-semibold text-foreground">{card.title}</p>
                  <p className="text-xs text-muted-foreground">{card.description}</p>
                </div>
                <Button asChild size="lg" className="w-full text-base">
                  <Link href={card.href}>{card.actionLabel}</Link>
                </Button>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
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
