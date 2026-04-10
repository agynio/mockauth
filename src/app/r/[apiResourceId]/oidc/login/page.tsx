import { cookies } from "next/headers";
import Link from "next/link";
import { format } from "date-fns";

import { LoginForm } from "@/app/r/[apiResourceId]/oidc/login/login-form";
import { ProxyStrategyTabs } from "@/app/r/[apiResourceId]/oidc/login/proxy-strategy-tabs";
import { Button } from "@/components/ui/button";
import {
  DEFAULT_CLIENT_AUTH_STRATEGIES,
  parseClientAuthStrategies,
  type ClientAuthStrategies,
} from "@/server/oidc/auth-strategy";
import { PREAUTHORIZED_PICKER_COOKIE } from "@/server/oidc/preauthorized/constants";
import { parseAuthorizeReturnTo, resolveAuthorizeReturnTo, toRelativeReturnTo } from "@/server/oidc/return-to";
import {
  enabledProxyStrategies,
  parseProxyAuthStrategies,
  type ProxyAuthStrategy,
} from "@/server/oidc/proxy-auth-strategy";
import { getApiResourceWithTenant } from "@/server/services/api-resource-service";
import { getClientForTenant } from "@/server/services/client-service";
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

const isProxyAuthStrategy = (value: string | null): value is ProxyAuthStrategy =>
  value === "redirect" || value === "preauthorized";

const isClientAuthStrategy = (value: string | null): value is "username" | "email" =>
  value === "username" || value === "email";

type PreauthorizedPanelState =
  | { state: "idle" }
  | { state: "error"; message: string }
  | { state: "ready"; identities: Array<{ id: string; label: string; metadata: string | null; updatedAtLabel: string }> };

export default async function TenantLoginPage({ params, searchParams }: LoginPageProps) {
  const { apiResourceId } = await params;
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const { tenant, resource } = await getApiResourceWithTenant(apiResourceId);
  const origin = await getRequestOrigin();
  const parsedReturnTo = parseAuthorizeReturnTo(resolvedSearchParams?.return_to, {
    apiResourceId: resource.id,
    origin,
  });
  const safeReturnTo = resolveAuthorizeReturnTo(resolvedSearchParams?.return_to, {
    apiResourceId: resource.id,
    origin,
  });
  const returnTo = toRelativeReturnTo(safeReturnTo);
  const requestedAuthStrategy = parsedReturnTo?.searchParams.get("auth_strategy") ?? null;
  const requestedProxyStrategy = isProxyAuthStrategy(requestedAuthStrategy) ? requestedAuthStrategy : null;
  const preferredStrategy = isClientAuthStrategy(requestedAuthStrategy) ? requestedAuthStrategy : undefined;

  let strategyConfig = DEFAULT_CLIENT_AUTH_STRATEGIES;
  let proxyClient: Awaited<ReturnType<typeof getClientForTenant>> | null = null;
  const clientId = parsedReturnTo?.searchParams.get("client_id");
  if (clientId) {
    try {
      const client = await getClientForTenant(tenant.id, clientId);
      if (client.oauthClientMode === "proxy") {
        proxyClient = client;
      } else {
        strategyConfig = parseClientAuthStrategies(client.authStrategies);
      }
    } catch {
      strategyConfig = DEFAULT_CLIENT_AUTH_STRATEGIES;
    }
  }

  if (proxyClient && parsedReturnTo) {
    const proxyStrategies = parseProxyAuthStrategies(proxyClient.proxyAuthStrategies);
    const enabledStrategies = enabledProxyStrategies(proxyStrategies);
    if (enabledStrategies.length === 0) {
      return renderUnavailable("No proxy login strategies are enabled for this client.");
    }

    const defaultStrategy =
      requestedProxyStrategy && enabledStrategies.includes(requestedProxyStrategy)
        ? requestedProxyStrategy
        : enabledStrategies.includes("redirect")
          ? "redirect"
          : enabledStrategies[0]!;

    const buildStrategyHref = (strategy: ProxyAuthStrategy) => {
      const nextReturnTo = new URL(parsedReturnTo.toString());
      nextReturnTo.searchParams.set("auth_strategy", strategy);
      return toRelativeReturnTo(nextReturnTo);
    };

    const redirectHref = proxyStrategies.redirect.enabled ? buildStrategyHref("redirect") : undefined;
    const preauthorizedHref = proxyStrategies.preauthorized.enabled ? buildStrategyHref("preauthorized") : undefined;

    let preauthorizedPanel: PreauthorizedPanelState | undefined;

    if (proxyStrategies.preauthorized.enabled && preauthorizedHref) {
      if (requestedProxyStrategy === "preauthorized") {
        const store = await cookies();
        const transactionId = store.get(PREAUTHORIZED_PICKER_COOKIE)?.value;
        if (!transactionId) {
          preauthorizedPanel = {
            state: "error",
            message: "The authorization request has expired. Please start again.",
          };
        } else {
          const transaction = await getPickerTransaction(transactionId);
          if (!transaction || transaction.apiResourceId !== apiResourceId) {
            preauthorizedPanel = {
              state: "error",
              message: "The authorization request could not be found.",
            };
          } else if (transaction.consumedAt || transaction.expiresAt < new Date()) {
            preauthorizedPanel = {
              state: "error",
              message: "This authorization request is no longer active.",
            };
          } else {
            const identities = await listPreauthorizedIdentities(transaction.tenantId, transaction.clientId);
            preauthorizedPanel = {
              state: "ready",
              identities: identities.map((identity) => {
                const label = identity.label ?? identity.providerEmail ?? identity.providerSubject ?? identity.id;
                const metadata = [identity.providerEmail, identity.providerSubject].filter(Boolean).join(" · ");
                return {
                  id: identity.id,
                  label,
                  metadata: metadata || null,
                  updatedAtLabel: `Last updated ${format(identity.updatedAt, "MMM d, yyyy 'at' h:mm a")}`,
                };
              }),
            };
          }
        }
      }

      if (!preauthorizedPanel) {
        preauthorizedPanel = { state: "idle" };
      }
    }

    return (
      <div className="flex min-h-screen items-center justify-center bg-surface-0 px-4 text-foreground">
        <div className="w-full max-w-2xl space-y-6 rounded-2xl border border-border bg-surface-1/90 p-8 shadow-2xl">
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold">Authorize {proxyClient.name}</h1>
            <p className="text-sm text-muted-foreground">
              Select how you want to authenticate to <strong>{tenant.name}</strong>.
            </p>
          </div>
          <ProxyStrategyTabs
            apiResourceId={apiResourceId}
            clientName={proxyClient.name}
            tenantName={tenant.name}
            strategies={enabledStrategies}
            defaultStrategy={defaultStrategy}
            redirectHref={redirectHref}
            preauthorizedHref={preauthorizedHref}
            preauthorizedPanel={preauthorizedPanel}
          />
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
