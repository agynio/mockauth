"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { signIn } from "next-auth/react";

import { cn } from "@/components/utils";

type SignInCtaProps = {
  isAuthenticated: boolean;
  className?: string;
  children?: ReactNode;
};

export function SignInCta({ isAuthenticated, className, children }: SignInCtaProps) {
  const label = children ?? "Sign in";

  if (isAuthenticated) {
    return (
      <Link href="/admin" className={cn(className)} data-testid="landing-sign-in-link">
        {label}
      </Link>
    );
  }

  const handleSignIn = () => {
    void signIn("logto", { callbackUrl: "/admin" });
  };

  return (
    <button type="button" onClick={handleSignIn} className={cn(className)} data-testid="landing-sign-in-link">
      {label}
    </button>
  );
}
