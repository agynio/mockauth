"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

import { prepareClientOauthTestAction } from "@/app/admin/actions";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";

type Props = {
  clientId: string;
  scopes: string;
  redirectUri: string;
};

export function TestRunAgainButton({ clientId, scopes, redirectUri }: Props) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const { toast } = useToast();

  const handleClick = () => {
    startTransition(async () => {
      try {
        const result = await prepareClientOauthTestAction({ clientId, scopes, redirectUri });
        if (result.error || !result.data) {
          toast({
            variant: "destructive",
            title: "Unable to restart test",
            description: result.error ?? "Something went wrong",
          });
          return;
        }
        router.push(result.data.authorizationUrl);
      } catch (error) {
        const description = error instanceof Error ? error.message : "Unknown error";
        toast({ variant: "destructive", title: "Unable to restart test", description });
        return;
      }
    });
  };

  return (
    <Button type="button" onClick={handleClick} disabled={pending} data-testid="test-oauth-run-again">
      {pending ? "Starting..." : "Run again"}
    </Button>
  );
}
