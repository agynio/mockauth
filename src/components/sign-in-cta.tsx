"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { signIn } from "next-auth/react";

type SignInCtaProps = {
  isAuthenticated: boolean;
  className?: string;
  children: ReactNode;
};

export function SignInCta({ isAuthenticated, className, children }: SignInCtaProps) {
  if (isAuthenticated) {
    return (
      <Link href="/admin" className={className} data-testid="landing-sign-in-link">
        {children}
      </Link>
    );
  }

  const handleSignIn = () => {
    void signIn("logto", { callbackUrl: "/admin" });
  };

  return (
    <button type="button" onClick={handleSignIn} className={className} data-testid="landing-sign-in-link">
      {children}
    </button>
  );
}
