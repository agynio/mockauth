"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { z } from "zod";
import { toNestErrors, validateFieldsNatively } from "@hookform/resolvers";
import { appendErrors, useFieldArray, useForm, useFormContext, useWatch } from "react-hook-form";
import type { Resolver } from "react-hook-form";
import type { ZodIssue } from "zod";

import { createClientAction } from "@/app/admin/actions";
import { CopyField } from "@/app/admin/_components/copy-field";
import {
  GRANT_TYPE_LABELS,
  TOKEN_AUTH_METHOD_LABELS,
  grantTypeOptions,
  tokenAuthMethodOptions,
} from "@/app/admin/clients/_constants";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import { RHFSelectField } from "@/components/rhf/rhf-select-field";
import {
  PROXY_TOKEN_AUTH_OPTIONS,
  getProxyTokenAuthDescription,
} from "@/app/admin/clients/proxy-auth-options";
import {
  DEFAULT_PROXY_AUTH_STRATEGIES,
  hasEnabledProxyStrategy,
  PROXY_AUTH_STRATEGY_METADATA,
  proxyAuthStrategiesZodSchema,
  type ProxyAuthStrategies,
} from "@/server/oidc/proxy-auth-strategy";

const scopeMappingSchema = z.object({
  appScope: z.string().optional(),
  providerScopes: z.string().optional(),
});

const proxyConfigSchema = z.object({
  providerType: z.enum(["oidc", "oauth2"]),
  authorizationEndpoint: z.string().optional(),
  tokenEndpoint: z.string().optional(),
  userinfoEndpoint: z.string().optional(),
  jwksUri: z.string().optional(),
  upstreamClientId: z.string().optional(),
  upstreamClientSecret: z.string().optional(),
  upstreamTokenEndpointAuthMethod: z.enum(["client_secret_basic", "client_secret_post", "none"]).default("client_secret_basic"),
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
    tokenEndpointAuthMethods: z
      .array(z.enum(tokenAuthMethodOptions))
      .min(1, "Select at least one token auth method"),
    pkceRequired: z.boolean().default(true),
    allowedGrantTypes: z
      .array(z.enum(grantTypeOptions))
      .min(1, "Select at least one grant type"),
    redirects: z.string().optional(),
    postLogoutRedirects: z.string().optional(),
    mode: z.enum(["regular", "proxy"] as const),
    proxyAuthStrategies: proxyAuthStrategiesZodSchema,
    proxyConfig: proxyConfigSchema.optional(),
  })
  .superRefine((values, ctx) => {
    if (values.mode === "regular") {
      return;
    }

    if (!hasEnabledProxyStrategy(values.proxyAuthStrategies)) {
      ctx.addIssue({
        path: ["proxyAuthStrategies", "root"],
        code: "custom",
        message: "Enable at least one strategy",
      });
    }

    const config = values.proxyConfig;
    if (!config) {
      ctx.addIssue({ path: ["proxyConfig"], code: "custom", message: "Proxy configuration is required" });
      return;
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

const createZodFieldErrors = (issues: ZodIssue[], collectAll: boolean) => {
  const pending = [...issues];
  const fieldErrors: Record<string, any> = {};

  while (pending.length > 0) {
    const issue = pending.shift()!;
    const path = issue.path.length > 0 ? issue.path.join(".") : "root";
    const type = issue.code;
    const message = issue.message;

    if (!fieldErrors[path]) {
      if ("unionErrors" in issue && Array.isArray(issue.unionErrors) && issue.unionErrors.length > 0) {
        const [firstUnion] = issue.unionErrors;
        const [unionIssue] = firstUnion.errors;
        fieldErrors[path] = { message: unionIssue.message, type: unionIssue.code };
      } else {
        fieldErrors[path] = { message, type };
      }
    }

    if ("unionErrors" in issue && Array.isArray(issue.unionErrors)) {
      issue.unionErrors.forEach((unionError) => {
        unionError.errors.forEach((unionIssue: ZodIssue) => {
          pending.push(unionIssue);
        });
      });
    }

    if (collectAll) {
      const existingTypes = fieldErrors[path].types;
      const previous = existingTypes && existingTypes[type];
      const nextMessage = previous
        ? Array.isArray(previous)
          ? [...previous, message]
          : [previous, message]
        : message;
      fieldErrors[path] = appendErrors(
        path,
        collectAll,
        fieldErrors,
        type,
        nextMessage,
      );
    }
  }

  return fieldErrors;
};

const proxyFormResolver: Resolver<FormValues> = async (values, context, options) => {
  const result = await formSchema.safeParseAsync(values);

  if (result.success) {
    if (options.shouldUseNativeValidation) {
      validateFieldsNatively({}, options);
    }
    return { values: result.data, errors: {} };
  }

  return {
    values: {},
    errors: toNestErrors(
      createZodFieldErrors(result.error.issues, !options.shouldUseNativeValidation && options.criteriaMode === "all"),
      options,
    ),
  };
};

const createDefaultProxyConfig = (): NonNullable<FormValues["proxyConfig"]> => ({
  providerType: "oidc",
  authorizationEndpoint: "",
  tokenEndpoint: "",
  userinfoEndpoint: "",
  jwksUri: "",
  upstreamClientId: "",
  upstreamClientSecret: "",
  upstreamTokenEndpointAuthMethod: "client_secret_basic",
  defaultScopes: "",
  scopeMappings: [],
  pkceSupported: true,
  oidcEnabled: true,
  promptPassthroughEnabled: false,
  loginHintPassthroughEnabled: false,
  passthroughTokenResponse: false,
});

const createDefaultProxyAuthStrategies = (): ProxyAuthStrategies => ({
  ...DEFAULT_PROXY_AUTH_STRATEGIES,
});

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

function ProxyScopeMappingFields({ pending }: { pending: boolean }) {
  const form = useFormContext<FormValues>();
  const { fields, append, remove } = useFieldArray({ control: form.control, name: "proxyConfig.scopeMappings" });

  return (
    <div className="space-y-3">
      <p className="text-sm font-semibold">Scope mapping</p>
      <p className="text-xs text-muted-foreground">
        Map each app-facing scope to provider scopes. Leave empty to forward the requested scope as-is.
      </p>
      <div className="space-y-3">
        {fields.length === 0 ? <p className="text-xs text-muted-foreground">No mappings configured.</p> : null}
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
  );
}

export function NewClientForm({ tenantId }: { tenantId: string }) {
  const form = useForm<FormValues>({
    resolver: proxyFormResolver,
    defaultValues: {
      name: "",
      tokenEndpointAuthMethods: ["client_secret_basic"],
      pkceRequired: true,
      allowedGrantTypes: ["authorization_code"],
      redirects: "",
      postLogoutRedirects: "",
      mode: "regular",
      proxyAuthStrategies: createDefaultProxyAuthStrategies(),
      proxyConfig: createDefaultProxyConfig(),
    },
  });
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [credentials, setCredentials] = useState<{
    clientId: string;
    clientSecret?: string;
    providerRedirectUri?: string;
  } | null>(null);

  const watchMode = useWatch({ control: form.control, name: "mode" });
  const watchTokenEndpoint = useWatch({ control: form.control, name: "proxyConfig.tokenEndpoint", defaultValue: "" });
  const tokenAuthDescription = useMemo(
    () => getProxyTokenAuthDescription(watchTokenEndpoint ?? undefined),
    [watchTokenEndpoint],
  );
  const { getValues, setValue } = form;

  useEffect(() => {
    if (watchMode === "regular") {
      return;
    }
    const currentConfig = getValues("proxyConfig");
    if (!currentConfig) {
      const defaults = createDefaultProxyConfig();
      setValue("proxyConfig", defaults, {
        shouldDirty: false,
        shouldTouch: false,
        shouldValidate: false,
      });
      setValue("proxyConfig.providerType", defaults.providerType, {
        shouldDirty: false,
        shouldTouch: false,
        shouldValidate: false,
      });
      setValue("proxyConfig.scopeMappings", defaults.scopeMappings ?? [], {
        shouldDirty: false,
        shouldTouch: false,
        shouldValidate: false,
      });
      return;
    }
    if (!currentConfig.providerType) {
      setValue("proxyConfig.providerType", "oidc", {
        shouldDirty: false,
        shouldTouch: false,
        shouldValidate: false,
      });
    }
    if (!Array.isArray(currentConfig.scopeMappings)) {
      setValue("proxyConfig.scopeMappings", [], {
        shouldDirty: false,
        shouldTouch: false,
        shouldValidate: false,
      });
    }
  }, [watchMode, getValues, setValue]);

  const tokenAuthOptions = PROXY_TOKEN_AUTH_OPTIONS;

  const onSubmit = (values: FormValues) => {
    startTransition(async () => {
      const redirectEntries = values.redirects
        ?.split(/\r?\n/)
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
      const postLogoutRedirectEntries = values.postLogoutRedirects
        ?.split(/\r?\n/)
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);

      const proxyConfigInput = values.mode === "proxy" && values.proxyConfig
        ? {
            providerType: values.proxyConfig.providerType,
            authorizationEndpoint: values.proxyConfig.authorizationEndpoint?.trim() ?? "",
            tokenEndpoint: values.proxyConfig.tokenEndpoint?.trim() ?? "",
            userinfoEndpoint: values.proxyConfig.userinfoEndpoint?.trim() || undefined,
            jwksUri: values.proxyConfig.jwksUri?.trim() || undefined,
            upstreamClientId: values.proxyConfig.upstreamClientId?.trim() ?? "",
            upstreamClientSecret: values.proxyConfig.upstreamClientSecret?.trim() || undefined,
            upstreamTokenEndpointAuthMethod: values.proxyConfig.upstreamTokenEndpointAuthMethod,
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
        tokenEndpointAuthMethods: values.tokenEndpointAuthMethods,
        pkceRequired: values.pkceRequired,
        allowedGrantTypes: values.allowedGrantTypes,
        redirects: redirectEntries,
        postLogoutRedirects: postLogoutRedirectEntries,
        mode: values.mode,
        proxyAuthStrategies: values.mode === "proxy" ? values.proxyAuthStrategies : undefined,
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
        tokenEndpointAuthMethods: values.tokenEndpointAuthMethods,
        pkceRequired: values.pkceRequired,
        allowedGrantTypes: values.allowedGrantTypes,
        redirects: "",
        postLogoutRedirects: "",
        mode: values.mode,
        proxyAuthStrategies: values.proxyAuthStrategies,
        proxyConfig: createDefaultProxyConfig(),
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
          name="tokenEndpointAuthMethods"
          render={({ field }) => (
            <FormItem className="space-y-3">
              <FormLabel>Token endpoint auth methods</FormLabel>
              <FormDescription>Select how the client authenticates during token exchange.</FormDescription>
              <div className="grid gap-3 md:grid-cols-3">
                {tokenAuthMethodOptions.map((option) => {
                  const meta = TOKEN_AUTH_METHOD_LABELS[option];
                  const selected = field.value ?? [];
                  const checked = selected.includes(option);
                  return (
                    <label key={option} className="flex items-start gap-3 rounded-md border p-3 text-sm">
                      <FormControl>
                        <input
                          type="checkbox"
                          className="mt-1 h-4 w-4 rounded border border-muted"
                          checked={checked}
                          onChange={(event) => {
                            const next = event.target.checked
                              ? [...new Set([...selected, option])]
                              : selected.filter((value) => value !== option);
                            const ordered = tokenAuthMethodOptions.filter((value) => next.includes(value));
                            field.onChange(ordered);
                          }}
                          disabled={pending}
                        />
                      </FormControl>
                      <span className="space-y-1">
                        <span className="block text-sm font-medium text-foreground">{meta.title}</span>
                        <span className="block text-xs text-muted-foreground">{meta.description}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="pkceRequired"
          render={({ field }) => (
            <FormItem>
              <div className="flex items-start gap-3 rounded-md border border-dashed p-3">
                <FormControl>
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 rounded border border-muted"
                    checked={field.value}
                    onChange={(event) => field.onChange(event.target.checked)}
                    disabled={pending}
                  />
                </FormControl>
                <div>
                  <FormLabel className="mb-1 block">Require PKCE</FormLabel>
                  <FormDescription>Enforce PKCE verification for authorization_code grants.</FormDescription>
                </div>
              </div>
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="allowedGrantTypes"
          render={({ field }) => (
            <FormItem className="space-y-3">
              <FormLabel>Grant types</FormLabel>
              <FormDescription>Choose which OAuth grant types the client can use.</FormDescription>
              <div className="grid gap-3 md:grid-cols-3">
                {grantTypeOptions.map((option) => {
                  const meta = GRANT_TYPE_LABELS[option];
                  const selected = field.value ?? [];
                  const checked = selected.includes(option);
                  return (
                    <label key={option} className="flex items-start gap-3 rounded-md border p-3 text-sm">
                      <FormControl>
                        <input
                          type="checkbox"
                          className="mt-1 h-4 w-4 rounded border border-muted"
                          checked={checked}
                          onChange={(event) => {
                            const next = event.target.checked
                              ? [...new Set([...selected, option])]
                              : selected.filter((value) => value !== option);
                            const ordered = grantTypeOptions.filter((value) => next.includes(value));
                            field.onChange(ordered);
                          }}
                          disabled={pending}
                        />
                      </FormControl>
                      <span className="space-y-1">
                        <span className="block text-sm font-medium text-foreground">{meta.title}</span>
                        <span className="block text-xs text-muted-foreground">{meta.description}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
              <FormMessage />
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

        {watchMode !== "regular" ? (
          <div className="space-y-6 rounded-md border border-dashed p-6">
            <div>
              <h3 className="text-base font-semibold">Upstream provider configuration</h3>
              <p className="text-sm text-muted-foreground">
                Provide discovery details and client credentials for the external IdP.
              </p>
            </div>

            <div className="space-y-4">
              <div>
                <h4 className="text-sm font-semibold">Proxy auth strategies</h4>
                <p className="text-xs text-muted-foreground">
                  Choose how upstream identities are selected during authorization.
                </p>
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                {(Object.keys(PROXY_AUTH_STRATEGY_METADATA) as (keyof ProxyAuthStrategies)[]).map((key) => (
                  <div key={key} className="rounded-md border p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h5 className="text-sm font-semibold text-foreground">
                          {PROXY_AUTH_STRATEGY_METADATA[key].title}
                        </h5>
                        <p className="text-xs text-muted-foreground">
                          {PROXY_AUTH_STRATEGY_METADATA[key].description}
                        </p>
                      </div>
                      <FormField
                        control={form.control}
                        name={`proxyAuthStrategies.${key}.enabled` as const}
                        render={({ field }) => (
                          <FormItem className="flex items-center gap-2">
                            <FormControl>
                              <input
                                type="checkbox"
                                className="h-4 w-4 rounded border border-muted"
                                checked={field.value}
                                onChange={(event) => field.onChange(event.target.checked)}
                                disabled={pending}
                                data-testid={`proxy-strategy-${key}-enabled`}
                              />
                            </FormControl>
                            <FormLabel className="text-xs text-muted-foreground">Enabled</FormLabel>
                          </FormItem>
                        )}
                      />
                    </div>
                  </div>
                ))}
              </div>
              {form.formState.errors.proxyAuthStrategies?.root?.message ? (
                <p className="text-sm text-destructive">{form.formState.errors.proxyAuthStrategies.root.message}</p>
              ) : null}
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <RHFSelectField
                control={form.control}
                name="proxyConfig.providerType"
                label="Provider type"
                placeholder="Select provider type"
                options={[
                  { value: "oidc", label: "OpenID Connect" },
                  { value: "oauth2", label: "OAuth 2.0" },
                ]}
                disabled={pending}
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

            <RHFSelectField
              control={form.control}
              name="proxyConfig.upstreamTokenEndpointAuthMethod"
              label="Token endpoint auth"
              placeholder="Select auth method"
              options={tokenAuthOptions}
              disabled={pending}
              description={tokenAuthDescription}
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

            <ProxyScopeMappingFields pending={pending} />

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

        <FormField
          control={form.control}
          name="postLogoutRedirects"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Post-logout redirect URIs</FormLabel>
              <FormControl>
                <Textarea rows={4} placeholder="https://client.example.test/logout" {...field} />
              </FormControl>
              <p className="text-xs text-muted-foreground">Enter one URI per line for logout redirects.</p>
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
              {credentials.providerRedirectUri ? (
                <CopyField label="Provider redirect URI" value={credentials.providerRedirectUri} testId="provider-redirect-uri" />
              ) : null}
            </CardContent>
          </Card>
        ) : null}
      </form>
    </Form>
  );
}
