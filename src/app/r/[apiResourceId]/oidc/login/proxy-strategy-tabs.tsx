"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PROXY_AUTH_STRATEGY_METADATA, type ProxyAuthStrategy } from "@/server/oidc/proxy-auth-strategy";

type PreauthorizedIdentityOption = {
  id: string;
  label: string;
  metadata: string | null;
  updatedAtLabel: string;
};

type PreauthorizedPanelState =
  | { state: "idle" }
  | { state: "error"; message: string }
  | { state: "ready"; identities: PreauthorizedIdentityOption[] };

type ProxyStrategyTabsProps = {
  apiResourceId: string;
  clientName: string;
  tenantName: string;
  strategies: ProxyAuthStrategy[];
  defaultStrategy: ProxyAuthStrategy;
  redirectHref?: string;
  preauthorizedHref?: string;
  preauthorizedPanel?: PreauthorizedPanelState;
};

export function ProxyStrategyTabs({
  apiResourceId,
  clientName,
  tenantName,
  strategies,
  defaultStrategy,
  redirectHref,
  preauthorizedHref,
  preauthorizedPanel,
}: ProxyStrategyTabsProps) {
  const router = useRouter();
  const [selectedStrategy, setSelectedStrategy] = useState<ProxyAuthStrategy>(defaultStrategy);
  const navigationRef = useRef<string | null>(null);
  const resolvedPreauthorizedPanel = preauthorizedPanel ?? { state: "idle" };
  const shouldAutoNavigate =
    selectedStrategy === "preauthorized" &&
    resolvedPreauthorizedPanel.state !== "ready" &&
    Boolean(preauthorizedHref);

  if (strategies.length === 0) {
    throw new Error("Proxy strategies are required");
  }

  useEffect(() => {
    if (!shouldAutoNavigate) {
      navigationRef.current = null;
      return;
    }
    if (!preauthorizedHref || navigationRef.current === preauthorizedHref) {
      return;
    }
    navigationRef.current = preauthorizedHref;
    router.push(preauthorizedHref);
  }, [preauthorizedHref, router, shouldAutoNavigate]);

  const renderRedirectPanel = (href: string) => {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">{PROXY_AUTH_STRATEGY_METADATA.redirect.description}</p>
        <Button asChild size="lg" className="w-full text-base">
          <Link href={href}>Continue</Link>
        </Button>
      </div>
    );
  };

  const renderIdentityList = (identities: PreauthorizedIdentityOption[]) => {
    if (identities.length === 0) {
      return (
        <Alert>
          <AlertTitle>No preauthorized identities</AlertTitle>
          <AlertDescription>
            An administrator must preauthorize at least one identity for this client before access can be granted.
          </AlertDescription>
        </Alert>
      );
    }

    return (
      <form method="POST" action={`/r/${apiResourceId}/oidc/login/preauthorized/select`} className="space-y-4">
        <fieldset className="space-y-3">
          {identities.map((identity, index) => (
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
                <div className="font-medium text-foreground">{identity.label}</div>
                {identity.metadata ? <div className="text-xs text-muted-foreground">{identity.metadata}</div> : null}
                <div className="text-[0.7rem] text-muted-foreground">{identity.updatedAtLabel}</div>
              </div>
            </label>
          ))}
        </fieldset>
        <Button type="submit" size="lg" className="w-full text-base">
          Continue
        </Button>
      </form>
    );
  };

  const renderPreauthorizedPanel = () => {
    if (resolvedPreauthorizedPanel.state === "ready") {
      return (
        <div className="space-y-4">
          <div className="space-y-2">
            <h2 className="text-lg font-semibold">Select a preauthorized identity</h2>
            <p className="text-sm text-muted-foreground">
              Choose which identity should authorize access to <strong>{clientName}</strong> on tenant{" "}
              <strong>{tenantName}</strong>.
            </p>
          </div>
          {renderIdentityList(resolvedPreauthorizedPanel.identities)}
        </div>
      );
    }

    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">{PROXY_AUTH_STRATEGY_METADATA.preauthorized.description}</p>
        {resolvedPreauthorizedPanel.state === "error" ? (
          <Alert>
            <AlertTitle>Preauthorized session unavailable</AlertTitle>
            <AlertDescription>{resolvedPreauthorizedPanel.message}</AlertDescription>
          </Alert>
        ) : null}
        {shouldAutoNavigate ? (
          <p className="text-xs text-muted-foreground animate-pulse" aria-live="polite">
            Loading preauthorized identities...
          </p>
        ) : null}
      </div>
    );
  };

  const renderStrategyPanel = (strategy: ProxyAuthStrategy) => {
    if (strategy === "redirect") {
      if (!redirectHref) {
        throw new Error("Redirect strategy is missing a target URL");
      }
      return renderRedirectPanel(redirectHref);
    }
    if (!preauthorizedHref) {
      throw new Error("Preauthorized strategy is missing a target URL");
    }
    return renderPreauthorizedPanel();
  };

  if (strategies.length <= 1) {
    return <div className="space-y-4">{renderStrategyPanel(strategies[0]!)}</div>;
  }

  return (
    <Tabs value={selectedStrategy} onValueChange={(value) => setSelectedStrategy(value as ProxyAuthStrategy)}>
      <TabsList className="grid w-full grid-cols-2">
        {strategies.map((strategy) => (
          <TabsTrigger
            key={strategy}
            value={strategy}
            className="data-[state=active]:bg-surface-2 data-[state=active]:text-foreground data-[state=active]:shadow data-[state=active]:ring-1 data-[state=active]:ring-brand-500/20"
          >
            {strategy === "redirect" ? "Redirect" : "Preauthorized"}
          </TabsTrigger>
        ))}
      </TabsList>
      {strategies.map((strategy) => (
        <TabsContent key={strategy} value={strategy} className="space-y-4">
          {renderStrategyPanel(strategy)}
        </TabsContent>
      ))}
    </Tabs>
  );
}
