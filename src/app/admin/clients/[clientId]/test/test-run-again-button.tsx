"use client";

import { useTransition } from "react";
import type { ReactNode } from "react";

import { prepareClientOauthTestAction } from "@/app/admin/actions";
import { Button, type ButtonProps } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { navigateTo } from "@/app/admin/clients/[clientId]/test/navigation";

type Props = {
  clientId: string;
  scopes: string;
  redirectUri: string;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  testId?: string;
  children?: ReactNode;
};

export function TestRunAgainButton({ clientId, scopes, redirectUri, variant, size, testId, children }: Props) {
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();
  const label = children ?? "Run again";

  const handleClick = () => {
    startTransition(async () => {
      try {
        const result = await prepareClientOauthTestAction({ clientId, scopes, redirectUri, promptLogin: false });
        if (result.error || !result.data) {
          toast({
            variant: "destructive",
            title: "Unable to restart test",
            description: result.error ?? "Something went wrong",
          });
          return;
        }
        navigateTo(result.data.authorizationUrl);
      } catch (error) {
        const description = error instanceof Error ? error.message : "Unknown error";
        toast({ variant: "destructive", title: "Unable to restart test", description });
        return;
      }
    });
  };

  return (
    <Button
      type="button"
      onClick={handleClick}
      disabled={pending}
      data-testid={testId ?? "test-oauth-run-again"}
      variant={variant}
      size={size}
    >
      {pending ? "Starting..." : label}
    </Button>
  );
}
