"use client";

import { useState } from "react";

import type { EmailVerifiedMode } from "@/server/oidc/auth-strategy";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

type StrategyOption = {
  key: "username" | "email";
  title: string;
  description: string;
  placeholder: string;
  subSource: string;
  emailVerifiedMode?: EmailVerifiedMode;
};

type LoginFormProps = {
  apiResourceId: string;
  returnTo: string;
  strategies: StrategyOption[];
  preferredStrategy?: StrategyOption["key"];
};

export function LoginForm({ apiResourceId, returnTo, strategies, preferredStrategy }: LoginFormProps) {
  const fallbackStrategy = strategies[0]?.key ?? "username";
  const initialStrategy = preferredStrategy && strategies.some((strategy) => strategy.key === preferredStrategy)
    ? preferredStrategy
    : fallbackStrategy;
  const [selectedStrategy, setSelectedStrategy] = useState<"username" | "email">(initialStrategy);
  const [emailVerifiedPreference, setEmailVerifiedPreference] = useState<"true" | "false">("true");

  const renderStrategyFields = (option: StrategyOption, isActive: boolean) => {
    const inputName = option.key === "username" ? "username" : "email";
    const inputType = option.key === "email" ? "email" : "text";
    return (
      <div key={option.key} className="space-y-4">
        <label className="block space-y-2 text-sm text-foreground">
          <span className="flex items-center justify-between">
            {option.title}
            <span className="text-[0.7rem] uppercase text-muted-foreground">
              {option.subSource === "entered" ? "Sub: entered" : "Sub: uuid"}
            </span>
          </span>
          <p className="text-xs text-muted-foreground">{option.description}</p>
          <Input
            type={inputType}
            name={inputName}
            required={isActive}
            disabled={!isActive}
            autoComplete="off"
            className="h-11 text-base"
            placeholder={option.placeholder}
            data-testid={`login-${option.key}-input`}
          />
        </label>
        {option.key === "email" && option.emailVerifiedMode === "user_choice" ? (
          <fieldset className="space-y-2" disabled={!isActive}>
            <legend className="text-xs font-semibold uppercase text-muted-foreground">Email verified flag</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="flex items-center gap-2 text-xs text-foreground">
                <input
                  type="radio"
                  name="email_verified_preference"
                  value="true"
                  checked={emailVerifiedPreference === "true"}
                  onChange={() => setEmailVerifiedPreference("true")}
                  disabled={!isActive}
                  className="h-4 w-4 rounded-full border border-border text-brand-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                />
                Verified
              </label>
              <label className="flex items-center gap-2 text-xs text-foreground">
                <input
                  type="radio"
                  name="email_verified_preference"
                  value="false"
                  checked={emailVerifiedPreference === "false"}
                  onChange={() => setEmailVerifiedPreference("false")}
                  disabled={!isActive}
                  className="h-4 w-4 rounded-full border border-border text-brand-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                />
                Unverified
              </label>
            </div>
            <p className="text-[0.7rem] text-muted-foreground">
              Choose how the email_verified claim should appear for this login.
            </p>
          </fieldset>
        ) : null}
      </div>
    );
  };

  return (
    <form method="POST" action={`/r/${apiResourceId}/oidc/login/submit`} className="space-y-4">
      <input type="hidden" name="strategy" value={selectedStrategy} data-testid="login-strategy-input" />
      <input type="hidden" name="return_to" value={returnTo} />
      {strategies.length > 1 ? (
        <Tabs
          value={selectedStrategy}
          onValueChange={(value) => setSelectedStrategy(value as "username" | "email")}
          className="space-y-4"
        >
          <TabsList className="grid w-full grid-cols-2" data-testid="login-strategy-tabs">
            {strategies.map((option) => (
              <TabsTrigger
                key={option.key}
                value={option.key}
                className="data-[state=active]:bg-surface-2 data-[state=active]:text-foreground data-[state=active]:shadow data-[state=active]:ring-1 data-[state=active]:ring-brand-500/20"
              >
                {option.title}
              </TabsTrigger>
            ))}
          </TabsList>
          {strategies.map((option) => (
            <TabsContent key={option.key} value={option.key} className="space-y-4">
              {renderStrategyFields(option, selectedStrategy === option.key)}
            </TabsContent>
          ))}
        </Tabs>
      ) : (
        renderStrategyFields(strategies[0]!, true)
      )}

      <Button type="submit" size="lg" className="w-full text-base">
        Continue
      </Button>
    </form>
  );
}
