"use client";

import { useState, useTransition } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { useRouter } from "next/navigation";

import { CopyField } from "@/app/admin/_components/copy-field";
import { prepareClientOauthTestAction, addRedirectUriAction } from "@/app/admin/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useToast } from "@/components/ui/use-toast";

const schema = z.object({
  scopes: z.string().min(1, "Enter at least one scope"),
  redirectUri: z
    .string()
    .min(1, "Enter a redirect URI")
    .refine((value) => {
      try {
        const url = new URL(value);
        return url.protocol === "https:" || url.protocol === "http:";
      } catch {
        return false;
      }
    }, "Enter an absolute http(s) URL"),
  clientSecret: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

type TestOAuthConfiguratorProps = {
  clientId: string;
  defaultScopes: string;
  defaultRedirectUri: string;
  canManageRedirects: boolean;
  redirectAllowed: boolean;
  requiresClientSecret: boolean;
};

export function TestOAuthConfigurator({
  clientId,
  defaultScopes,
  defaultRedirectUri,
  canManageRedirects,
  redirectAllowed: redirectAllowedProp,
  requiresClientSecret,
}: TestOAuthConfiguratorProps) {
  const { toast } = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [authorizationUrl, setAuthorizationUrl] = useState<string | null>(null);
  const [redirectAllowed, setRedirectAllowed] = useState(redirectAllowedProp);
  const [addingRedirect, startAddRedirect] = useTransition();

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { scopes: defaultScopes, redirectUri: defaultRedirectUri, clientSecret: "" },
  });

  const scopesValue = useWatch({ control: form.control, name: "scopes" }) ?? "";
  const normalizedScopes = scopesValue
    .split(/\s+/)
    .map((scope) => scope.trim())
    .filter(Boolean)
    .join(" ");

  const handleAddRedirect = () => {
    if (!canManageRedirects || redirectAllowed) {
      return;
    }
    startAddRedirect(async () => {
      const result = await addRedirectUriAction({ clientId, uri: defaultRedirectUri });
      if (result.error) {
        toast({ variant: "destructive", title: "Unable to save redirect", description: result.error });
        return;
      }
      setRedirectAllowed(true);
      toast({ title: "Redirect added", description: "The admin test callback is now allowed." });
    });
  };

  const onSubmit = form.handleSubmit((values) => {
    if (requiresClientSecret && !values.clientSecret?.trim()) {
      form.setError("clientSecret", { type: "manual", message: "Client secret is required" });
      return;
    }
    if (!redirectAllowed) {
      toast({
        variant: "destructive",
        title: "Redirect not allowed",
        description: "Add the admin test redirect before starting the flow.",
      });
      return;
    }
    startTransition(async () => {
      const result = await prepareClientOauthTestAction({
        clientId,
        scopes: values.scopes,
        redirectUri: values.redirectUri,
        clientSecret: values.clientSecret,
      });
      if (result.error || !result.data) {
        toast({ variant: "destructive", title: "Unable to generate URL", description: result.error });
        return;
      }
      setAuthorizationUrl(result.data.authorizationUrl);
      router.push(result.data.authorizationUrl);
    });
  });

  return (
    <div className="space-y-6">
      <CopyField
        label="Admin test redirect"
        value={defaultRedirectUri}
        description="This redirect stays internal to confirm tokens."
        testId="test-oauth-redirect"
      />
      {!redirectAllowed ? (
        <Alert className="border-amber-500/60 bg-amber-50 text-amber-900" data-testid="test-oauth-warning">
          <AlertTitle>Allow this redirect first</AlertTitle>
          <AlertDescription className="space-y-3">
            <p>Add {defaultRedirectUri} to the client before launching a test.</p>
            {canManageRedirects ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleAddRedirect}
                disabled={addingRedirect}
                data-testid="test-oauth-add-redirect"
              >
                {addingRedirect ? "Adding..." : "Add redirect"}
              </Button>
            ) : (
              <p className="text-xs text-muted-foreground">Contact an owner to add this redirect URI.</p>
            )}
          </AlertDescription>
        </Alert>
      ) : null}
      <Form {...form}>
        <form className="space-y-4" onSubmit={onSubmit}>
          <FormField
            control={form.control}
            name="scopes"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Scopes</FormLabel>
                <FormControl>
                  <Input {...field} data-testid="test-oauth-scopes" />
                </FormControl>
                <FormMessage />
                <p className="text-xs text-muted-foreground">Preview: {normalizedScopes || "n/a"}</p>
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="redirectUri"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Redirect URI</FormLabel>
                <FormControl>
                  <Input {...field} data-testid="test-oauth-redirect-input" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          {requiresClientSecret ? (
            <FormField
              control={form.control}
              name="clientSecret"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Client secret</FormLabel>
                  <FormControl>
                    <Input {...field} type="password" data-testid="test-oauth-secret" autoComplete="off" />
                  </FormControl>
                  <FormMessage />
                  <p className="text-xs text-muted-foreground">Paste the most recent secret for this client.</p>
                </FormItem>
              )}
            />
          ) : null}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            {authorizationUrl ? (
              <CopyField
                label="Authorization URL"
                value={authorizationUrl}
                testId="test-oauth-authorization-url"
                description="Share this URL if you prefer to test outside the admin UI."
              />
            ) : (
              <p className="text-xs text-muted-foreground">Start a test to generate the authorization URL.</p>
            )}
            <Button type="submit" disabled={pending} data-testid="test-oauth-start">
              {pending ? "Starting..." : "Start test"}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}
