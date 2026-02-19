"use client";

import Link from "next/link";
import { AlertCircle, LifeBuoy } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const SUPPORT_EMAIL = "support@agyn.io";

const errorMessages: Record<string, { title: string; description: string }> = {
  OAuthAccountNotLinked: {
    title: "Account needs to be linked",
    description:
      "Your Logto identity exists, but it has not been linked to an admin profile yet. Retry to trigger linking, or ask QA to reset your access.",
  },
  OAuthSignin: {
    title: "Unable to reach Logto",
    description: "We could not reach the Logto provider. Please try again in a moment.",
  },
};

type ErrorPageProps = {
  searchParams?: {
    error?: string;
    callbackUrl?: string;
  };
};

export default function AuthErrorPage({ searchParams }: ErrorPageProps) {
  const errorCode = searchParams?.error ?? "";
  const callbackUrl = searchParams?.callbackUrl ?? "/admin";
  const copy = errorMessages[errorCode] ?? {
    title: "We could not sign you in",
    description: "Retry the request. If the issue persists, reach out to QA for help.",
  };

  const retryHref = `/api/auth/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`;
  const supportHref = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(
    `Mockauth sign-in error: ${errorCode || "unknown"}`,
  )}`;

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 px-4 py-16">
      <div className="mx-auto w-full max-w-xl rounded-xl border bg-background p-8 shadow-sm">
        <div className="flex items-center gap-3">
          <AlertCircle className="h-6 w-6 text-destructive" aria-hidden />
          <div>
            <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">Sign-in error</p>
            <h1 className="text-2xl font-semibold leading-tight text-foreground">{copy.title}</h1>
          </div>
        </div>
        <p className="mt-4 text-base text-muted-foreground">{copy.description}</p>
        {errorCode ? (
          <p className="mt-2 text-sm text-muted-foreground">
            Error code: <span className="font-mono">{errorCode}</span>
          </p>
        ) : null}
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href={retryHref} className={buttonVariants({ size: "lg" })}>
            Try again
          </Link>
          <a
            href={supportHref}
            className={cn(buttonVariants({ variant: "outline", size: "lg" }), "flex items-center gap-2")}
          >
            <LifeBuoy className="h-4 w-4" aria-hidden />
            Contact support
          </a>
        </div>
      </div>
    </main>
  );
}
