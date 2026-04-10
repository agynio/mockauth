import { format } from "date-fns";
import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { PREAUTHORIZED_PICKER_COOKIE } from "@/server/oidc/preauthorized/constants";
import { parseAuthorizeReturnTo, resolveAuthorizeReturnTo, toRelativeReturnTo } from "@/server/oidc/return-to";
import { getClientForTenant } from "@/server/services/client-service";
import { getApiResourceWithTenant } from "@/server/services/api-resource-service";
import { listPreauthorizedIdentities } from "@/server/services/preauthorized-identity-service";
import { getPickerTransaction } from "@/server/services/preauthorized-picker-service";
import { getRequestOrigin } from "@/server/utils/request-origin";

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

const renderPreauthorizedError = (message: string) => (
  <div className="flex min-h-screen items-center justify-center bg-surface-0 px-4 text-foreground">
    <div className="w-full max-w-md rounded-2xl border border-border bg-surface-1/90 p-8 text-center shadow-2xl">
      <h1 className="mb-3 text-2xl font-semibold">Preauthorized session unavailable</h1>
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
  const origin = await getRequestOrigin();
  const parsedReturnTo = parseAuthorizeReturnTo(resolvedSearchParams?.return_to, {
    apiResourceId: resource.id,
    origin,
  });
  const requestedAuthStrategy = parsedReturnTo?.searchParams.get("auth_strategy");
  const preferredStrategy =
    requestedAuthStrategy === "username" || requestedAuthStrategy === "email" ? requestedAuthStrategy : undefined;
  const safeReturnTo = resolveAuthorizeReturnTo(resolvedSearchParams?.return_to, {
    apiResourceId: resource.id,
    origin,
  });
  const returnTo = toRelativeReturnTo(safeReturnTo);
  let strategyConfig = DEFAULT_CLIENT_AUTH_STRATEGIES;
  let proxyClient: Awaited<ReturnType<typeof getClientForTenant>> | null = null;
  try {
    const clientId = parsedReturnTo?.searchParams.get("client_id");
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

  if (proxyClient && parsedReturnTo) {
    const proxyStrategies = parseProxyAuthStrategies(proxyClient.proxyAuthStrategies);
    const enabledStrategies = enabledProxyStrategies(proxyStrategies);
    if (enabledStrategies.length === 0) {
      return renderUnavailable("No proxy login strategies are enabled for this client.");
    }

    if (requestedAuthStrategy === "preauthorized") {
      if (!proxyStrategies.preauthorized.enabled) {
        return renderUnavailable("Preauthorized identities are not enabled for this client.");
      }

      const store = await cookies();
      const transactionId = store.get(PREAUTHORIZED_PICKER_COOKIE)?.value;
      if (!transactionId) {
        return renderPreauthorizedError("The authorization request has expired. Please start again.");
      }

      const transaction = await getPickerTransaction(transactionId);
      if (!transaction || transaction.apiResourceId !== apiResourceId) {
        return renderPreauthorizedError("The authorization request could not be found.");
      }
      if (transaction.consumedAt || transaction.expiresAt < new Date()) {
        return renderPreauthorizedError("This authorization request is no longer active.");
      }

      const identities = await listPreauthorizedIdentities(transaction.tenantId, transaction.clientId);
      let redirectStrategyUrl: string | null = null;
      if (proxyStrategies.redirect.enabled) {
        const redirectUrl = new URL(parsedReturnTo.toString());
        redirectUrl.searchParams.set("auth_strategy", "redirect");
        redirectStrategyUrl = toRelativeReturnTo(redirectUrl);
      }

      return (
        <div className="flex min-h-screen items-center justify-center bg-surface-0 px-4 text-foreground">
          <div className="w-full max-w-2xl space-y-6 rounded-2xl border border-border bg-surface-1/90 p-8 shadow-2xl">
            <div className="space-y-2">
              <h1 className="text-2xl font-semibold">Select a preauthorized identity</h1>
              <p className="text-sm text-muted-foreground">
                Choose which identity should authorize access to <strong>{transaction.client.name}</strong> on tenant{" "}
                <strong>{tenant.name}</strong>.
              </p>
              {redirectStrategyUrl ? (
                <Button asChild variant="link" size="sm" className="h-auto p-0 text-xs">
                  <Link href={redirectStrategyUrl}>Use redirect instead</Link>
                </Button>
              ) : null}
            </div>

            {identities.length === 0 ? (
              <Alert>
                <AlertTitle>No preauthorized identities</AlertTitle>
                <AlertDescription>
                  An administrator must preauthorize at least one identity for this client before access can be granted.
                </AlertDescription>
              </Alert>
            ) : (
              <form
                method="POST"
                action={`/r/${apiResourceId}/oidc/preauthorized/picker/select`}
                className="space-y-4"
              >
                <fieldset className="space-y-3">
                  {identities.map((identity, index) => {
                    const label = identity.label ?? identity.providerEmail ?? identity.providerSubject ?? identity.id;
                    const metadata = [identity.providerEmail, identity.providerSubject].filter(Boolean).join(" · ");
                    return (
                      <label
                        key={identity.id}
                        className="flex gap-3 rounded-xl border border-border bg-surface-2/70 p-4 text-sm shadow-sm"
                      >
                        <input
                          type="radio"
                          name="identity_id"
                          value={identity.id}
                          required
                          defaultChecked={index === 0}
                          className="mt-1 h-4 w-4 rounded-full border border-border text-brand-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                        />
                        <div className="space-y-1">
                          <div className="font-medium text-foreground">{label}</div>
                          {metadata ? <div className="text-xs text-muted-foreground">{metadata}</div> : null}
                          <div className="text-[0.7rem] text-muted-foreground">
                            Last updated {format(identity.updatedAt, "MMM d, yyyy 'at' h:mm a")}
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </fieldset>
                <Button type="submit" size="lg" className="w-full text-base">
                  Continue
                </Button>
              </form>
            )}
          </div>
        </div>
      );
    }

    if (enabledStrategies.length === 1) {
      const redirectUrl = new URL(parsedReturnTo.toString());
      redirectUrl.searchParams.set("auth_strategy", enabledStrategies[0]!);
      redirect(toRelativeReturnTo(redirectUrl));
    }

    const buildStrategyUrl = (strategy: ProxyAuthStrategy) => {
      const redirectUrl = new URL(parsedReturnTo.toString());
      redirectUrl.searchParams.set("auth_strategy", strategy);
      return toRelativeReturnTo(redirectUrl);
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
  const preferredEnabledStrategy = preferredStrategy && strategies.some((strategy) => strategy.key === preferredStrategy)
    ? preferredStrategy
    : undefined;

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-0 px-4 text-foreground">
      <div className="w-full max-w-md rounded-2xl border border-border bg-surface-1/90 p-8 shadow-2xl">
        <h1 className="mb-2 text-2xl font-semibold">Log in to {tenant.name}</h1>
        <p className="mb-6 text-sm text-muted-foreground">
          Enter any {strategySummary} to simulate an end-user signing in. The session is scoped to tenant {tenant.id}.
        </p>
        <LoginForm
          apiResourceId={apiResourceId}
          returnTo={returnTo}
          strategies={strategies}
          preferredStrategy={preferredEnabledStrategy}
        />
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
