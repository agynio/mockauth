"use client";

import { useState } from "react";

import type { EmailVerifiedMode } from "@/server/oidc/auth-strategy";

type StrategyOption = {
  key: "username" | "email";
  title: string;
  description: string;
  placeholder: string;
  subSource: string;
  emailVerifiedMode?: EmailVerifiedMode;
};

type LoginFormProps = {
  tenantId: string;
  apiResourceId: string;
  returnTo: string;
  strategies: StrategyOption[];
};

export function LoginForm({ tenantId, apiResourceId, returnTo, strategies }: LoginFormProps) {
  const [selectedStrategy, setSelectedStrategy] = useState<"username" | "email">(strategies[0]?.key ?? "username");
  const [emailVerifiedPreference, setEmailVerifiedPreference] = useState<"true" | "false">("true");

  return (
    <form method="POST" action={`/t/${tenantId}/r/${apiResourceId}/oidc/login/submit`} className="space-y-4">
      <input type="hidden" name="strategy" value={selectedStrategy} />
      <input type="hidden" name="return_to" value={returnTo} />
      {strategies.length > 1 ? (
        <div className="space-y-2" role="radiogroup" aria-label="Authentication strategy">
          <p className="text-xs font-semibold uppercase text-muted-foreground">Choose a strategy</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {strategies.map((option) => (
              <label
                key={option.key}
                className={`cursor-pointer rounded-md border p-3 text-sm transition ${
                  selectedStrategy === option.key ? "border-amber-400 bg-amber-50 text-slate-900" : "border-slate-800"
                }`}
              >
                <div className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="strategy-choice"
                    value={option.key}
                    checked={selectedStrategy === option.key}
                    onChange={() => setSelectedStrategy(option.key)}
                    className="h-4 w-4"
                  />
                  <span className="font-semibold">{option.title}</span>
                </div>
                <p className="mt-1 text-xs">
                  {option.description}
                </p>
              </label>
            ))}
          </div>
        </div>
      ) : null}

      {strategies.map((option) => {
        const isActive = option.key === selectedStrategy;
        const inputName = option.key === "username" ? "username" : "email";
        const inputType = option.key === "email" ? "email" : "text";
        return (
          <label key={option.key} className={`space-y-2 block text-sm ${isActive ? "" : "opacity-60"}`}>
            <span className="text-slate-200 flex items-center justify-between">
              {option.title}
              <span className="text-[0.7rem] uppercase text-slate-400">{option.subSource === "entered" ? "Sub: entered" : "Sub: uuid"}</span>
            </span>
            <input
              type={inputType}
              name={inputName}
              required={isActive}
              disabled={!isActive}
              autoComplete="off"
              className="w-full rounded-lg border border-slate-700 bg-slate-950/40 px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-amber-400 disabled:cursor-not-allowed disabled:opacity-70"
              placeholder={option.placeholder}
            />
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
          </label>
        );
      })}

      <button
        type="submit"
        className="w-full rounded-lg bg-amber-400 px-4 py-2 font-semibold text-slate-950 hover:bg-amber-300"
      >
        Continue
      </button>
    </form>
  );
}
