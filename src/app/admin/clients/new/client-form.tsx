"use client";

import { useState, useTransition } from "react";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useFieldArray, useForm, useWatch } from "react-hook-form";

import { createClientAction } from "@/app/admin/actions";
import { CopyField } from "@/app/admin/_components/copy-field";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const scopeMappingSchema = z.object({
  appScope: z.string().optional(),
  providerScopes: z.string().optional(),
});

const proxyConfigSchema = z.object({
  providerType: z.enum(["oidc", "oauth2"]).optional(),
  authorizationEndpoint: z.string().optional(),
  tokenEndpoint: z.string().optional(),
  userinfoEndpoint: z.string().optional(),
  jwksUri: z.string().optional(),
  upstreamClientId: z.string().optional(),
  upstreamClientSecret: z.string().optional(),
  defaultScopes: z.string().optional(),
  scopeMappings: z.array(scopeMappingSchema).optional(),
  pkceSupported: z.boolean().default(true),
  oidcEnabled: z.boolean().default(true),
  promptPassthroughEnabled: z.boolean().default(false),
  loginHintPassthroughEnabled: z.boolean().default(false),
  passthroughTokenResponse: z.boolean().default(false),
});

const formSchema = z
  .object({
    name: z.string().min(2, "Name must be at least 2 characters"),
    type: z.enum(["CONFIDENTIAL", "PUBLIC"] as const),
    redirects: z.string().optional(),
    mode: z.enum(["regular", "proxy"] as const),
    proxyConfig: proxyConfigSchema.optional(),
  })
  .superRefine((values, ctx) => {
    if (values.mode !== "proxy") {
      return;
    }

    const config = values.proxyConfig;
    if (!config) {
      ctx.addIssue({ path: ["proxyConfig"], code: "custom", message: "Proxy configuration is required" });
      return;
    }

    if (!config.providerType) {
      ctx.addIssue({ path: ["proxyConfig", "providerType"], code: "custom", message: "Select a provider type" });
    }

    const requiredFields: Array<[keyof typeof config, string]> = [
      ["authorizationEndpoint", "Authorization endpoint is required"],
      ["tokenEndpoint", "Token endpoint is required"],
      ["upstreamClientId", "Provider client ID is required"],
    ];

    for (const [field, message] of requiredFields) {
      const rawValue = config[field];
      if (typeof rawValue !== "string" || rawValue.trim().length === 0) {
        ctx.addIssue({ path: ["proxyConfig", field], code: "custom", message });
      }
    }

    const urlFields: Array<[keyof typeof config, string]> = [
      ["authorizationEndpoint", "Enter a valid URL"],
      ["tokenEndpoint", "Enter a valid URL"],
      ["userinfoEndpoint", "Enter a valid URL"],
      ["jwksUri", "Enter a valid URL"],
    ];

    for (const [field, message] of urlFields) {
      const rawValue = config[field];
      if (typeof rawValue !== "string" || rawValue.trim().length === 0) {
        continue;
      }
      try {
        new URL(rawValue);
      } catch (error) {
        ctx.addIssue({ path: ["proxyConfig", field], code: "custom", message });
      }
    }

    if (config.scopeMappings) {
      config.scopeMappings.forEach((mapping, index) => {
        if (mapping?.appScope && mapping.appScope.trim().length === 0) {
          ctx.addIssue({
            path: ["proxyConfig", "scopeMappings", index, "appScope"],
            code: "custom",
            message: "App scope is required",
          });
        }
        if (mapping?.providerScopes && mapping.providerScopes.trim().length === 0) {
          ctx.addIssue({
            path: ["proxyConfig", "scopeMappings", index, "providerScopes"],
            code: "custom",
            message: "Provider scopes are required",
          });
        }
      });
    }
  });

type FormValues = z.infer<typeof formSchema>;

const defaultProxyConfig: NonNullable<FormValues["proxyConfig"]> = {
  providerType: "oidc",
  authorizationEndpoint: "",
  tokenEndpoint: "",
  userinfoEndpoint: "",
  jwksUri: "",
  upstreamClientId: "",
  upstreamClientSecret: "",
  defaultScopes: "",
  scopeMappings: [],
  pkceSupported: true,
  oidcEnabled: true,
  promptPassthroughEnabled: false,
  loginHintPassthroughEnabled: false,
  passthroughTokenResponse: false,
};

const splitScopes = (value?: string | null) => {
  if (!value) {
    return [];
  }
  return Array.from(new Set(value.split(/\s+/).map((scope) => scope.trim()).filter((scope) => scope.length > 0)));
};

const buildScopeMapping = (
  rows?: NonNullable<FormValues["proxyConfig"]>["scopeMappings"],
): Record<string, string[]> | undefined => {
  if (!rows || !Array.isArray(rows)) {
    return undefined;
  }
  const mapping: Record<string, string[]> = {};
  rows.forEach((row) => {
    if (!row?.appScope) {
      return;
    }
    const key = row.appScope.trim();
    if (!key) {
      return;
    }
    const valueScopes = splitScopes(row.providerScopes);
    if (valueScopes.length === 0) {
      return;
    }
    mapping[key] = valueScopes;
  });
  return Object.keys(mapping).length > 0 ? mapping : undefined;
};

export function NewClientForm({ tenantId }: { tenantId: string }) {
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      type: "CONFIDENTIAL",
      redirects: "",
      mode: "regular",
      proxyConfig: defaultProxyConfig,
    },
  });
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [credentials, setCredentials] = useState<{ clientId: string; clientSecret?: string } | null>(null);

  const watchMode = useWatch({ control: form.control, name: "mode" });
  const { fields, append, remove } = useFieldArray({ control: form.control, name: "proxyConfig.scopeMappings" });

  const onSubmit = (values: FormValues) => {
    startTransition(async () => {
      const redirectEntries = values.redirects
        ?.split(/\r?\n/)
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);

      const proxyConfigInput = values.mode === "proxy" && values.proxyConfig
        ? {
            providerType: values.proxyConfig.providerType ?? "oidc",
            authorizationEndpoint: values.proxyConfig.authorizationEndpoint?.trim() ?? "",
            tokenEndpoint: values.proxyConfig.tokenEndpoint?.trim() ?? "",
            userinfoEndpoint: values.proxyConfig.userinfoEndpoint?.trim() || undefined,
            jwksUri: values.proxyConfig.jwksUri?.trim() || undefined,
            upstreamClientId: values.proxyConfig.upstreamClientId?.trim() ?? "",
            upstreamClientSecret: values.proxyConfig.upstreamClientSecret?.trim() || undefined,
            defaultScopes: splitScopes(values.proxyConfig.defaultScopes),
            scopeMapping: buildScopeMapping(values.proxyConfig.scopeMappings),
            pkceSupported: Boolean(values.proxyConfig.pkceSupported),
            oidcEnabled: Boolean(values.proxyConfig.oidcEnabled),
            promptPassthroughEnabled: Boolean(values.proxyConfig.promptPassthroughEnabled),
            loginHintPassthroughEnabled: Boolean(values.proxyConfig.loginHintPassthroughEnabled),
            passthroughTokenResponse: Boolean(values.proxyConfig.passthroughTokenResponse),
          }
        : undefined;

      const result = await createClientAction({
        tenantId,
        name: values.name,
        type: values.type,
        redirects: redirectEntries,
        mode: values.mode,
        proxyConfig: proxyConfigInput,
      });

      if (result.error) {
        toast({ variant: "destructive", title: "Unable to create client", description: result.error });
        return;
      }

      toast({ title: "Client created", description: result.success ?? "Client is ready" });
      setCredentials(result.data ?? null);
      form.reset({
        name: "",
        type: values.type,
        redirects: "",
        mode: values.mode,
        proxyConfig: defaultProxyConfig,
      });
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
          name="mode"
          render={({ field }) => (
            <FormItem className="space-y-3">
              <FormLabel>Client mode</FormLabel>
              <Tabs value={field.value} onValueChange={field.onChange} className="w-full">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="regular">Regular</TabsTrigger>
                  <TabsTrigger value="proxy">Proxy</TabsTrigger>
                </TabsList>
                <TabsContent value="regular" className="rounded-md border p-4 text-sm text-muted-foreground">
                  MockAuth issues and validates tokens directly.
                </TabsContent>
                <TabsContent value="proxy" className="rounded-md border p-4 text-sm text-muted-foreground">
                  Delegate authentication to an upstream identity provider while MockAuth brokers OAuth flows.
                </TabsContent>
              </Tabs>
            </FormItem>
          )}
        />

        {watchMode === "proxy" ? (
          <div className="space-y-6 rounded-md border border-dashed p-6">
            <div>
              <h3 className="text-base font-semibold">Upstream provider configuration</h3>
              <p className="text-sm text-muted-foreground">
                Provide discovery details and client credentials for the external IdP.
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <FormField
                control={form.control}
                name="proxyConfig.providerType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Provider type</FormLabel>
                    <Select value={field.value ?? "oidc"} onValueChange={field.onChange} disabled={pending}>
                      <FormControl>
                        <SelectTrigger className="justify-between">
                          <SelectValue placeholder="Select provider type" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="oidc">OpenID Connect</SelectItem>
                        <SelectItem value="oauth2">OAuth 2.0</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="proxyConfig.upstreamClientId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Provider client ID</FormLabel>
                    <FormControl>
                      <Input placeholder="client-123" {...field} disabled={pending} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="proxyConfig.upstreamClientSecret"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Provider client secret</FormLabel>
                  <FormControl>
                    <Input placeholder="Optional" type="password" {...field} disabled={pending} />
                  </FormControl>
                  <FormMessage />
                  <p className="text-xs text-muted-foreground">Leave blank for public providers or if mutual TLS applies.</p>
                </FormItem>
              )}
            />

            <div className="grid gap-4 md:grid-cols-2">
              <FormField
                control={form.control}
                name="proxyConfig.authorizationEndpoint"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Authorization endpoint</FormLabel>
                    <FormControl>
                      <Input placeholder="https://idp.example.com/oauth2/authorize" {...field} disabled={pending} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="proxyConfig.tokenEndpoint"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Token endpoint</FormLabel>
                    <FormControl>
                      <Input placeholder="https://idp.example.com/oauth2/token" {...field} disabled={pending} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <FormField
                control={form.control}
                name="proxyConfig.userinfoEndpoint"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Userinfo endpoint</FormLabel>
                    <FormControl>
                      <Input placeholder="Optional" {...field} disabled={pending} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="proxyConfig.jwksUri"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>JWKS URI</FormLabel>
                    <FormControl>
                      <Input placeholder="Optional" {...field} disabled={pending} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="proxyConfig.defaultScopes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Default provider scopes</FormLabel>
                  <FormControl>
                    <Textarea rows={3} placeholder="openid profile email" {...field} disabled={pending} />
                  </FormControl>
                  <p className="text-xs text-muted-foreground">
                    Space-separated list applied when the app does not request explicit scopes.
                  </p>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="space-y-3">
              <FormLabel>Scope mapping</FormLabel>
              <p className="text-xs text-muted-foreground">
                Map each app-facing scope to provider scopes. Leave empty to forward the requested scope as-is.
              </p>
              <div className="space-y-3">
                {fields.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No mappings configured.</p>
                ) : null}
                {fields.map((fieldItem, index) => (
                  <div key={fieldItem.id} className="flex flex-col gap-3 rounded-md border p-4 md:flex-row md:items-center">
                    <FormField
                      control={form.control}
                      name={`proxyConfig.scopeMappings.${index}.appScope`}
                      render={({ field }) => (
                        <FormItem className="flex-1">
                          <FormLabel className="text-xs uppercase tracking-wide">App scope</FormLabel>
                          <FormControl>
                            <Input placeholder="profile:read" {...field} disabled={pending} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name={`proxyConfig.scopeMappings.${index}.providerScopes`}
                      render={({ field }) => (
                        <FormItem className="flex-1">
                          <FormLabel className="text-xs uppercase tracking-wide">Provider scopes</FormLabel>
                          <FormControl>
                            <Input placeholder="openid profile" {...field} disabled={pending} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => remove(index)}
                      disabled={pending}
                      className="md:self-end"
                    >
                      Remove
                    </Button>
                  </div>
                ))}
              </div>
              <Button type="button" variant="outline" onClick={() => append({ appScope: "", providerScopes: "" })} disabled={pending}>
                Add mapping
              </Button>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <FormField
                control={form.control}
                name="proxyConfig.pkceSupported"
                render={({ field }) => (
                  <FormItem className="flex items-center justify-between gap-4 rounded-md border p-4">
                    <div>
                      <FormLabel className="text-sm font-semibold">Provider supports PKCE</FormLabel>
                      <p className="text-xs text-muted-foreground">Include code_verifier when exchanging tokens.</p>
                    </div>
                    <FormControl>
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border border-muted"
                        checked={field.value}
                        onChange={(event) => field.onChange(event.target.checked)}
                        disabled={pending}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="proxyConfig.oidcEnabled"
                render={({ field }) => (
                  <FormItem className="flex items-center justify-between gap-4 rounded-md border p-4">
                    <div>
                      <FormLabel className="text-sm font-semibold">Provider issues ID tokens</FormLabel>
                      <p className="text-xs text-muted-foreground">MockAuth will request nonce and expect ID tokens.</p>
                    </div>
                    <FormControl>
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border border-muted"
                        checked={field.value}
                        onChange={(event) => field.onChange(event.target.checked)}
                        disabled={pending}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <FormField
                control={form.control}
                name="proxyConfig.promptPassthroughEnabled"
                render={({ field }) => (
                  <FormItem className="flex items-center justify-between gap-4 rounded-md border p-4">
                    <div>
                      <FormLabel className="text-sm font-semibold">Passthrough prompt</FormLabel>
                      <p className="text-xs text-muted-foreground">Forward prompt=login to force upstream re-authentication.</p>
                    </div>
                    <FormControl>
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border border-muted"
                        checked={field.value}
                        onChange={(event) => field.onChange(event.target.checked)}
                        disabled={pending}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="proxyConfig.loginHintPassthroughEnabled"
                render={({ field }) => (
                  <FormItem className="flex items-center justify-between gap-4 rounded-md border p-4">
                    <div>
                      <FormLabel className="text-sm font-semibold">Passthrough login_hint</FormLabel>
                      <p className="text-xs text-muted-foreground">Send the user hint to the upstream provider.</p>
                    </div>
                    <FormControl>
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border border-muted"
                        checked={field.value}
                        onChange={(event) => field.onChange(event.target.checked)}
                        disabled={pending}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="proxyConfig.passthroughTokenResponse"
              render={({ field }) => (
                <FormItem className="flex items-center justify-between gap-4 rounded-md border p-4">
                  <div>
                    <FormLabel className="text-sm font-semibold">Passthrough token payload</FormLabel>
                    <p className="text-xs text-muted-foreground">
                      Return the upstream token response verbatim instead of a filtered subset.
                    </p>
                  </div>
                  <FormControl>
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border border-muted"
                      checked={field.value}
                      onChange={(event) => field.onChange(event.target.checked)}
                      disabled={pending}
                    />
                  </FormControl>
                </FormItem>
              )}
            />
          </div>
        ) : null}

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
