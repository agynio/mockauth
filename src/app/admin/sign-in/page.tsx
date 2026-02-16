"use client";

import { useTransition } from "react";

import Link from "next/link";
import { signIn } from "next-auth/react";

export default function AdminSignInPage() {
  const [isPending, startTransition] = useTransition();

  const handleSignIn = () => {
    startTransition(() => {
      void signIn("logto", { callbackUrl: "/admin" });
    });
  };

  return (
    <div className="mx-auto max-w-xl space-y-6 rounded-2xl border border-slate-800 bg-slate-950/50 p-8 text-center">
      <div className="space-y-2">
        <p className="text-sm uppercase tracking-wide text-amber-300">Admin access</p>
        <h1 className="text-3xl font-semibold text-white">Sign in with Logto</h1>
        <p className="text-sm text-slate-300">
          The admin console relies on our shared Logto tenant. Use the provided QA credentials to continue.
        </p>
      </div>
      <button
        type="button"
        onClick={handleSignIn}
        disabled={isPending}
        className="w-full rounded-lg bg-amber-400 py-3 font-semibold text-slate-900 transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-70"
      >
        {isPending ? "Redirecting..." : "Sign in with Logto"}
      </button>
      <p className="text-xs text-slate-500">Having trouble? Use the fallback link below.</p>
      <div>
        <Link href="/api/auth/signin/logto" className="text-sm font-medium text-slate-200 underline-offset-2 hover:underline">
          Continue via /api/auth/signin/logto
        </Link>
      </div>
    </div>
  );
}
