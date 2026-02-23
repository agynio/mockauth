"use client";

import { useState } from "react";

import type { EmailVerifiedMode } from "@/server/oidc/auth-strategy";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

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
};

export function LoginForm({ apiResourceId, returnTo, strategies }: LoginFormProps) {
  const [selectedStrategy, setSelectedStrategy] = useState<"username" | "email">(strategies[0]?.key ?? "username");
  const [emailVerifiedPreference, setEmailVerifiedPreference] = useState<"true" | "false">("true");

  const renderStrategyFields = (option: StrategyOption, isActive: boolean) => {
    const inputName = option.key === "username" ? "username" : "email";
    const inputType = option.key === "email" ? "email" : "text";
    return (
      <div key={option.key} className="space-y-4">
        <label className="space-y-2 block text-sm">
          <span className="text-slate-200 flex items-center justify-between">
            {option.title}
            <span className="text-[0.7rem] uppercase text-slate-400">
              {option.subSource === "entered" ? "Sub: entered" : "Sub: uuid"}
            </span>
          </span>
          <p className="text-xs text-slate-400">{option.description}</p>
          <input
            type={inputType}
            name={inputName}
            required={isActive}
            disabled={!isActive}
            autoComplete="off"
            className="w-full rounded-lg border border-slate-700 bg-slate-950/40 px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-amber-400 disabled:cursor-not-allowed disabled:opacity-70"
            placeholder={option.placeholder}
            data-testid={`login-${option.key}-input`}
          />
        </label>
        {option.key === "email" && option.emailVerifiedMode === "user_choice" ? (
          <fieldset className="space-y-2" disabled={!isActive}>
            <legend className="text-xs font-semibold uppercase text-slate-400">Email verified flag</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="flex items-center gap-2 text-xs text-slate-200">
                <input
                  type="radio"
                  name="email_verified_preference"
                  value="true"
                  checked={emailVerifiedPreference === "true"}
                  onChange={() => setEmailVerifiedPreference("true")}
                  disabled={!isActive}
                  className="h-4 w-4"
                />
                Verified
              </label>
              <label className="flex items-center gap-2 text-xs text-slate-200">
                <input
                  type="radio"
                  name="email_verified_preference"
                  value="false"
                  checked={emailVerifiedPreference === "false"}
                  onChange={() => setEmailVerifiedPreference("false")}
                  disabled={!isActive}
                  className="h-4 w-4"
                />
                Unverified
              </label>
            </div>
            <p className="text-[0.7rem] text-slate-400">Choose how the email_verified claim should appear for this login.</p>
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
              <TabsTrigger key={option.key} value={option.key} className="data-[state=active]:bg-amber-50 data-[state=active]:text-slate-900">
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

      <button
        type="submit"
        className="w-full rounded-lg bg-amber-400 px-4 py-2 font-semibold text-slate-950 hover:bg-amber-300"
      >
        Continue
      </button>
    </form>
  );
}
