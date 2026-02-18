"use client";

import { useState, useTransition } from "react";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";

import { createClientAction } from "@/app/admin/actions";
import { CopyField } from "@/app/admin/_components/copy-field";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";

const formSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  type: z.enum(["CONFIDENTIAL", "PUBLIC"] as const),
  redirects: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

export function NewClientForm({ tenantId }: { tenantId: string }) {
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: "", type: "CONFIDENTIAL", redirects: "" },
  });
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [credentials, setCredentials] = useState<{ clientId: string; clientSecret?: string } | null>(null);

  const onSubmit = (values: FormValues) => {
    startTransition(async () => {
      const redirectEntries = values.redirects
        ?.split(/\r?\n/)
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
      const result = await createClientAction({
        tenantId,
        name: values.name,
        type: values.type,
        redirects: redirectEntries,
      });

      if (result.error) {
        toast({ variant: "destructive", title: "Unable to create client", description: result.error });
        return;
      }

      toast({ title: "Client created", description: result.success ?? "Client is ready" });
      setCredentials(result.data ?? null);
      form.reset({ name: "", type: values.type, redirects: "" });
    });
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Client name</FormLabel>
              <FormControl>
                <Input placeholder="Demo SPA" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="type"
          render={({ field }) => (
            <FormItem className="space-y-3">
              <FormLabel>Client type</FormLabel>
              <Tabs value={field.value} onValueChange={field.onChange} className="w-full">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="CONFIDENTIAL">Confidential</TabsTrigger>
                  <TabsTrigger value="PUBLIC">Public</TabsTrigger>
                </TabsList>
                <TabsContent value="CONFIDENTIAL" className="rounded-md border p-4 text-sm text-muted-foreground">
                  Server-based apps that can securely store client secrets and authenticate via HTTP basic auth.
                </TabsContent>
                <TabsContent value="PUBLIC" className="rounded-md border p-4 text-sm text-muted-foreground">
                  Native or browser apps leveraging PKCE. No client secret is issued for these clients.
                </TabsContent>
              </Tabs>
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="redirects"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Redirect URIs</FormLabel>
              <FormControl>
                <Textarea rows={4} placeholder="https://client.example.test/callback" {...field} />
              </FormControl>
              <p className="text-xs text-muted-foreground">Enter one URI per line. Wildcards are normalized automatically.</p>
              <FormMessage />
            </FormItem>
          )}
        />

        <Button type="submit" disabled={pending} className="w-full">
          {pending ? "Creating…" : "Create client"}
        </Button>

        {credentials ? (
          <Card className="border-primary/30 bg-primary/5">
            <CardHeader>
              <CardTitle className="text-base">Credentials</CardTitle>
              <CardDescription>Copy these values now—secrets are shown only once.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <CopyField label="Client ID" value={credentials.clientId} />
              {credentials.clientSecret ? (
                <CopyField label="Client secret" value={credentials.clientSecret} />
              ) : (
                <p className="text-sm text-muted-foreground">Public clients do not receive secrets.</p>
              )}
            </CardContent>
          </Card>
        ) : null}
      </form>
    </Form>
  );
}
