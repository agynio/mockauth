"use client";

import { useEffect, useReducer, useState, useTransition, type FormEvent, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { Loader2, Trash2, X } from "lucide-react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch } from "react-hook-form";

import {
  addRedirectUriAction,
  deleteRedirectUriAction,
  rotateClientSecretAction,
  updateClientAuthStrategiesAction,
  updateClientScopesAction,
  updateClientIssuerAction,
  updateClientNameAction,
  updateClientReauthTtlAction,
  updateClientSigningAlgsAction,
} from "@/app/admin/actions";
import { CopyField } from "@/app/admin/_components/copy-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ClientAuthStrategies } from "@/server/oidc/auth-strategy";
import { cn } from "@/lib/utils";
import { isValidScopeValue, normalizeScopes } from "@/server/oidc/scopes";
import { DEFAULT_JWT_SIGNING_ALG, SUPPORTED_JWT_SIGNING_ALGS } from "@/server/oidc/signing-alg";
import type { JwtSigningAlg } from "@/generated/prisma/client";

const nameSchema = z.object({ name: z.string().min(2, "Name must be at least 2 characters") });
const redirectSchema = z.object({
  uri: z
    .string()
    .min(1, "Enter a redirect URI")
    .superRefine((value, ctx) => {
      const trimmed = value.trim();
      if (trimmed === "*") {
        return;
      }
      try {
        const url = new URL(trimmed);
        if (!url.protocol.startsWith("http")) {
          throw new Error("invalid");
        }
      } catch {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Enter an absolute URL or *" });
      }
    }),
});
const issuerSchema = z.object({ resourceId: z.union([z.literal("default"), z.string().min(1)]) });
const strategyConfigSchema = z.object({ enabled: z.boolean(), subSource: z.enum(["entered", "generated_uuid"]) });
const emailStrategyConfigSchema = strategyConfigSchema.extend({ emailVerifiedMode: z.enum(["true", "false", "user_choice"]) });
const authStrategiesSchema = z
  .object({ username: strategyConfigSchema, email: emailStrategyConfigSchema })
  .refine((value) => value.username.enabled || value.email.enabled, {
    message: "Enable at least one strategy",
    path: ["root"],
  });
const MAX_REAUTH_TTL_SECONDS = 86400;
const reauthTtlSchema = z.object({
  reauthTtlSeconds: z.coerce
    .number()
    .int("Enter a whole number"),
});

const idTokenAlgOptions = ["default", ...SUPPORTED_JWT_SIGNING_ALGS] as const;
const accessTokenAlgOptions = ["match_id", ...SUPPORTED_JWT_SIGNING_ALGS] as const;
const signingAlgsSchema = z.object({
  idTokenAlg: z.enum(idTokenAlgOptions),
  accessTokenAlg: z.enum(accessTokenAlgOptions),
});

const SIGNING_ALG_LABELS: Record<JwtSigningAlg, string> = {
  RS256: "RS256 (RSA SHA-256)",
  PS256: "PS256 (RSA-PSS SHA-256)",
  ES256: "ES256 (ECDSA P-256)",
  ES384: "ES384 (ECDSA P-384)",
};

function renderSigningAlgLabel(value: string | undefined, kind: "id" | "access"): string {
  if (!value) {
    return kind === "id" ? "Select ID token algorithm" : "Select access token algorithm";
  }
  if (kind === "id") {
    return value === "default"
      ? `Platform default (${DEFAULT_JWT_SIGNING_ALG})`
      : SIGNING_ALG_LABELS[value as JwtSigningAlg];
  }
  return value === "match_id" ? "Match ID token (default)" : SIGNING_ALG_LABELS[value as JwtSigningAlg];
}

const formatReauthTtlSummary = (seconds: number) => {
  if (!seconds) {
    return "0 seconds = always require a fresh sign-in.";
  }
  if (seconds < 60) {
    return `Allows reuse for ${seconds} second${seconds === 1 ? "" : "s"}.`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60 && remainingSeconds === 0) {
    return `Allows reuse for ${minutes} minute${minutes === 1 ? "" : "s"}.`;
  }
  if (minutes < 60) {
    return `Allows reuse for ${minutes} minute${minutes === 1 ? "" : "s"} ${remainingSeconds} second${remainingSeconds === 1 ? "" : "s"}.`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (remainingMinutes === 0 && remainingSeconds === 0) {
    return `Allows reuse for ${hours} hour${hours === 1 ? "" : "s"}.`;
  }
  const parts = [`${hours} hour${hours === 1 ? "" : "s"}`];
  if (remainingMinutes) {
    parts.push(`${remainingMinutes} minute${remainingMinutes === 1 ? "" : "s"}`);
  }
  if (remainingSeconds) {
    parts.push(`${remainingSeconds} second${remainingSeconds === 1 ? "" : "s"}`);
  }
  return `Allows reuse for ${parts.join(" ")}.`;
};

const ensureCanonicalScopes = (values: string[]): string[] => {
  const normalized = normalizeScopes(values);
  if (!normalized.includes("openid")) {
    return ["openid", ...normalized];
  }
  return ["openid", ...normalized.filter((scope) => scope !== "openid")];
};

type ScopeFormState = {
  scopes: string[];
  input: string;
  error: string | null;
};

type ScopeFormAction =
  | { type: "reset"; scopes: string[] }
  | { type: "add"; scope: string }
  | { type: "remove"; scope: string }
  | { type: "setInput"; value: string }
  | { type: "setError"; value: string | null };

const scopeFormReducer = (state: ScopeFormState, action: ScopeFormAction): ScopeFormState => {
  switch (action.type) {
    case "reset":
      return { scopes: action.scopes, input: "", error: null };
    case "add":
      return { scopes: ensureCanonicalScopes([...state.scopes, action.scope]), input: "", error: null };
    case "remove":
      return { ...state, scopes: ensureCanonicalScopes(state.scopes.filter((value) => value !== action.scope)) };
    case "setInput":
      return { ...state, input: action.value };
    case "setError":
      return { ...state, error: action.value };
    default:
      return state;
  }
};

export function UpdateClientNameForm({
  clientId,
  initialName,
  canEdit,
}: {
  clientId: string;
  initialName: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const form = useForm<z.infer<typeof nameSchema>>({ resolver: zodResolver(nameSchema), defaultValues: { name: initialName } });
  const [pending, startTransition] = useTransition();
  const [manualError, setManualError] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    form.reset({ name: initialName });
  }, [initialName, form]);

  const onSubmit = (values: z.infer<typeof nameSchema>) => {
    startTransition(async () => {
      const result = await updateClientNameAction({ clientId, name: values.name });
      if (result.error) {
        toast({ variant: "destructive", title: "Unable to update", description: result.error });
        return;
      }
      router.refresh();
      toast({ title: "Client updated", description: result.success ?? "Saved" });
    });
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem className="space-y-1">
              <FormLabel className="text-xs text-muted-foreground">Client name</FormLabel>
              <FormControl>
                <Input {...field} disabled={!canEdit || pending} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        {canEdit ? (
          <Button type="submit" disabled={pending} className="self-end">
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
          </Button>
        ) : (
          <Button type="button" variant="outline" disabled className="self-end">
            Read-only
          </Button>
        )}
      </form>
    </Form>
  );
}

export function UpdateClientSigningAlgorithmsForm({
  clientId,
  initialIdTokenAlg,
  initialAccessTokenAlg,
  canEdit,
}: {
  clientId: string;
  initialIdTokenAlg: JwtSigningAlg | null;
  initialAccessTokenAlg: JwtSigningAlg | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const form = useForm<z.infer<typeof signingAlgsSchema>>({
    resolver: zodResolver(signingAlgsSchema),
    defaultValues: {
      idTokenAlg: initialIdTokenAlg ?? "default",
      accessTokenAlg: initialAccessTokenAlg ?? "match_id",
    },
  });

  useEffect(() => {
    form.reset({
      idTokenAlg: initialIdTokenAlg ?? "default",
      accessTokenAlg: initialAccessTokenAlg ?? "match_id",
    });
  }, [initialIdTokenAlg, initialAccessTokenAlg, form]);

  const watchedIdAlg = useWatch({ control: form.control, name: "idTokenAlg" });
  const watchedAccessAlg = useWatch({ control: form.control, name: "accessTokenAlg" });

  const resolvedIdAlg: JwtSigningAlg = watchedIdAlg === "default" ? DEFAULT_JWT_SIGNING_ALG : (watchedIdAlg as JwtSigningAlg);
  const resolvedAccessAlg: JwtSigningAlg = watchedAccessAlg === "match_id" ? resolvedIdAlg : (watchedAccessAlg as JwtSigningAlg);

  const onSubmit = (values: z.infer<typeof signingAlgsSchema>) => {
    startTransition(async () => {
      const result = await updateClientSigningAlgsAction({ clientId, ...values });
      if (result.error) {
        toast({ variant: "destructive", title: "Unable to update", description: result.error });
        return;
      }
      router.refresh();
      toast({ title: "Signing algorithms updated", description: result.success ?? "Saved" });
    });
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="idTokenAlg"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs text-muted-foreground">ID token algorithm</FormLabel>
              <FormControl>
                <Select
                  value={field.value}
                  defaultValue={field.value}
                  onValueChange={field.onChange}
                  disabled={!canEdit || pending}
                >
                  <SelectTrigger>
                    <span className={cn("truncate", !field.value && "text-muted-foreground")}>
                      {renderSigningAlgLabel(field.value, "id")}
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">Platform default ({DEFAULT_JWT_SIGNING_ALG})</SelectItem>
                    {SUPPORTED_JWT_SIGNING_ALGS.map((alg) => (
                      <SelectItem key={alg} value={alg}>
                        {SIGNING_ALG_LABELS[alg]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormControl>
              <FormDescription className="text-xs">
                Defaults to {DEFAULT_JWT_SIGNING_ALG}. Change when relying parties require a different signature.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="accessTokenAlg"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs text-muted-foreground">Access token algorithm</FormLabel>
              <FormControl>
                <Select
                  value={field.value}
                  defaultValue={field.value}
                  onValueChange={field.onChange}
                  disabled={!canEdit || pending}
                >
                  <SelectTrigger>
                    <span className={cn("truncate", !field.value && "text-muted-foreground")}>
                      {renderSigningAlgLabel(field.value, "access")}
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="match_id">Match ID token (default)</SelectItem>
                    {SUPPORTED_JWT_SIGNING_ALGS.map((alg) => (
                      <SelectItem key={alg} value={alg}>
                        {SIGNING_ALG_LABELS[alg]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormControl>
              <FormDescription className="text-xs">
                Inherits the ID token algorithm unless overridden. Useful for asymmetric access token policies.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <p className="text-xs text-muted-foreground">
          ID tokens will use <span className="font-medium text-foreground">{resolvedIdAlg}</span>. Access tokens will use
          <span className="font-medium text-foreground"> {resolvedAccessAlg}</span>.
        </p>

        {canEdit ? (
          <Button type="submit" disabled={pending}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save algorithms"}
          </Button>
        ) : (
          <Button type="button" variant="outline" disabled className="cursor-not-allowed opacity-70">
            Read-only
          </Button>
        )}
      </form>
    </Form>
  );
}

export function UpdateClientReauthTtlForm({
  clientId,
  initialTtl,
  canEdit,
}: {
  clientId: string;
  initialTtl: number;
  canEdit: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const form = useForm<z.infer<typeof reauthTtlSchema>>({
    resolver: zodResolver(reauthTtlSchema),
    defaultValues: { reauthTtlSeconds: initialTtl },
  });
  const ttlValue = useWatch({ control: form.control, name: "reauthTtlSeconds" }) ?? 0;

  useEffect(() => {
    form.reset({ reauthTtlSeconds: initialTtl });
  }, [initialTtl, form]);

  const onSubmit = form.handleSubmit((values) => {
    if (values.reauthTtlSeconds < 0) {
      form.setError("reauthTtlSeconds", { type: "manual", message: "Enter 0 or a positive number" });
      return;
    }
    if (values.reauthTtlSeconds > MAX_REAUTH_TTL_SECONDS) {
      form.setError("reauthTtlSeconds", {
        type: "manual",
        message: `Limit to ${MAX_REAUTH_TTL_SECONDS.toLocaleString()} seconds (24 hours)`,
      });
      return;
    }
    form.clearErrors("reauthTtlSeconds");
    startTransition(async () => {
      const result = await updateClientReauthTtlAction({ clientId, reauthTtlSeconds: values.reauthTtlSeconds });
      if (result.error) {
        toast({ variant: "destructive", title: "Unable to update", description: result.error });
        return;
      }
      router.refresh();
      toast({ title: "Re-auth TTL updated", description: result.success ?? "Saved" });
    });
  });

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} noValidate className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <FormField
          control={form.control}
          name="reauthTtlSeconds"
          render={({ field }) => (
            <FormItem className="space-y-1">
              <FormLabel>Session reuse TTL (seconds)</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  type="number"
                  min={0}
                  max={MAX_REAUTH_TTL_SECONDS}
                  inputMode="numeric"
                  disabled={!canEdit || pending}
                  data-testid="reauth-ttl-input"
                />
              </FormControl>
              <FormMessage />
              <p className="text-xs text-muted-foreground">{formatReauthTtlSummary(Number(ttlValue) || 0)}</p>
              <p className="text-xs text-muted-foreground">Max {MAX_REAUTH_TTL_SECONDS.toLocaleString()} seconds (24 hours).</p>
            </FormItem>
          )}
        />
        {canEdit ? (
          <Button type="submit" disabled={pending} className="self-end" data-testid="reauth-ttl-save">
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
          </Button>
        ) : (
          <Button type="button" variant="outline" disabled className="self-end">
            Read-only
          </Button>
        )}
      </form>
    </Form>
  );
}

export function RotateSecretForm({ clientId, canRotate }: { clientId: string; canRotate: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const { toast } = useToast();

  if (!canRotate) {
    return (
      <Alert>
        <AlertDescription>Client secrets can only be rotated by owners or writers.</AlertDescription>
      </Alert>
    );
  }

  const rotate = () => {
    startTransition(async () => {
      const result = await rotateClientSecretAction({ clientId });
      if (result.error) {
        toast({ variant: "destructive", title: "Unable to rotate", description: result.error });
        return;
      }
      if (result.data?.clientSecret) {
        setClientSecret(result.data.clientSecret);
      }
      router.refresh();
      toast({ title: "Client secret rotated", description: "Copy the new secret immediately" });
    });
  };

  return (
    <div className="space-y-4">
      {clientSecret ? (
        <CopyField
          label="New client secret"
          value={clientSecret}
          description="Secret is shown once. Store securely."
        />
      ) : null}
      <Button type="button" variant="secondary" onClick={rotate} disabled={pending} className="w-full">
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Rotate secret"}
      </Button>
    </div>
  );
}

export function AddRedirectForm({ clientId, canEdit }: { clientId: string; canEdit: boolean }) {
  const router = useRouter();
  const form = useForm<z.infer<typeof redirectSchema>>({ resolver: zodResolver(redirectSchema), defaultValues: { uri: "" } });
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();
  const watchedField = useWatch({ control: form.control, name: "uri" }) ?? "";
  const watchedUri = watchedField.trim();
  const normalized = watchedUri.toLowerCase();
  const isAnyWildcard = watchedUri === "*";
  const isHostWildcard = !isAnyWildcard && normalized.startsWith("https://*.");
  const isPathWildcard =
    !isAnyWildcard && !isHostWildcard && watchedUri.endsWith("/*") && normalized.startsWith("http");

  const onSubmit = (values: z.infer<typeof redirectSchema>) => {
    startTransition(async () => {
      const result = await addRedirectUriAction({ clientId, uri: values.uri });
      if (result.error) {
        toast({ variant: "destructive", title: "Unable to save redirect", description: result.error });
        return;
      }
      toast({ title: "Redirect saved" });
      form.reset();
      router.refresh();
    });
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <FormField
          control={form.control}
          name="uri"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Redirect URI</FormLabel>
              <FormControl>
                <Input placeholder="https://app.example.com/callback or *" {...field} disabled={!canEdit || pending} />
              </FormControl>
              <FormMessage />
              {isAnyWildcard ? (
                <Alert variant="destructive" data-testid="redirect-any-warning" className="mt-3">
                  <AlertTitle>QA-only wildcard</AlertTitle>
                  <AlertDescription>
                    Allowing <span className="font-mono">*</span> matches every redirect URI and only works when
                    MOCKAUTH_ALLOW_ANY_REDIRECT=true. Never enable this in production.
                  </AlertDescription>
                </Alert>
              ) : null}
              {!isAnyWildcard && (isHostWildcard || isPathWildcard) ? (
                <Alert
                  data-testid="redirect-wildcard-warning"
                  className="mt-3 border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/40"
                >
                  <AlertTitle>Wildcard redirects are for QA</AlertTitle>
                  <AlertDescription>
                    Host and path wildcards are intended for QA environments only and must not be used for production tenants.
                  </AlertDescription>
                </Alert>
              ) : null}
            </FormItem>
          )}
        />
        <Button type="submit" disabled={!canEdit || pending} className="self-end">
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add"}
        </Button>
      </form>
    </Form>
  );
}

export function UpdateClientScopesForm({
  clientId,
  initialScopes,
  canEdit,
}: {
  clientId: string;
  initialScopes: string[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [state, dispatch] = useReducer(scopeFormReducer, initialScopes, (scopes: string[]): ScopeFormState => ({
    scopes: ensureCanonicalScopes(scopes),
    input: "",
    error: null,
  }));
  const { scopes, input, error } = state;

  useEffect(() => {
    dispatch({ type: "reset", scopes: ensureCanonicalScopes(initialScopes) });
  }, [initialScopes]);

  const addScope = (raw: string) => {
    if (!canEdit || pending) {
      return;
    }
    const candidate = raw.trim().toLowerCase();
    if (!candidate) {
      return;
    }
    if (!isValidScopeValue(candidate)) {
      dispatch({ type: "setError", value: "Scopes must match ^[a-z0-9:_-]{1,64}$" });
      return;
    }
    dispatch({ type: "add", scope: candidate });
  };

  const removeScope = (scope: string) => {
    if (!canEdit || pending || scope === "openid") {
      return;
    }
    dispatch({ type: "remove", scope });
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!scopes.includes("openid")) {
      dispatch({ type: "setError", value: "Scopes must include openid" });
      return;
    }

    startTransition(async () => {
      const result = await updateClientScopesAction({ clientId, scopes });
      if (result.error) {
        toast({ variant: "destructive", title: "Unable to update", description: result.error });
        return;
      }
      const nextScopes = result.data?.allowedScopes ?? scopes;
      dispatch({ type: "reset", scopes: ensureCanonicalScopes(nextScopes) });
      router.refresh();
      toast({ title: "Scopes updated", description: result.success ?? "Saved" });
    });
  };

  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      addScope(input);
    }
  };

  const suggestedScopes = ["profile", "email", "address", "phone", "offline_access"];

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-3">
        <div>
          <p className="text-sm font-semibold text-foreground">Allowed scopes</p>
          <p className="text-xs text-muted-foreground">
            openid is required. Additional scopes must match the pattern {"^[a-z0-9:_-]{1,64}$"}.
          </p>
        </div>
        <div className="flex flex-wrap gap-2" data-testid="scope-chip-list">
          {scopes.map((scope) => (
            <Badge
              key={scope}
              variant="secondary"
              className="flex items-center gap-1 rounded-full px-3 py-1 text-xs"
              data-testid={`scope-chip-${scope}`}
            >
              {scope}
              {scope !== "openid" && canEdit ? (
                <button
                  type="button"
                  onClick={() => removeScope(scope)}
                  className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground hover:text-destructive"
                  aria-label={`Remove ${scope}`}
                  data-testid={`remove-scope-${scope}`}
                  disabled={pending}
                >
                  <X className="h-3 w-3" />
                </button>
              ) : null}
            </Badge>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <Input
          value={input}
          onChange={(event) => {
            dispatch({ type: "setInput", value: event.target.value });
            if (error) {
              dispatch({ type: "setError", value: null });
            }
          }}
          onKeyDown={handleInputKeyDown}
          placeholder="Add a scope and press Enter"
          disabled={!canEdit || pending}
          data-testid="scope-input"
        />
        {error ? <p className="text-xs font-medium text-destructive">{error}</p> : null}
        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
          {suggestedScopes
            .filter((scope) => !scopes.includes(scope))
            .map((scope) => (
              <Button
                key={scope}
                type="button"
                size="sm"
                variant="outline"
                className="h-7 px-2 text-xs"
                onClick={() => addScope(scope)}
                disabled={!canEdit || pending}
                data-testid={`scope-suggestion-${scope}`}
              >
                {scope}
              </Button>
            ))}
        </div>
      </div>

      <Button type="submit" disabled={!canEdit || pending} className="w-full sm:w-auto" data-testid="scope-save-button">
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : canEdit ? "Save scopes" : "Read-only"}
      </Button>
    </form>
  );
}

const strategyMetadata: Record<keyof ClientAuthStrategies, { title: string; description: string; placeholder: string }> = {
  username: {
    title: "Username",
    description: "QA users enter an arbitrary username (no validation).",
    placeholder: "qa-user",
  },
  email: {
    title: "Email",
    description: "Accepts an email-like string and exposes only email claims.",
    placeholder: "qa-user@example.test",
  },
};

const SUBJECT_SOURCE_LABELS: Record<"entered" | "generated_uuid", string> = {
  entered: "Use entered value",
  generated_uuid: "Generate UUID (stable per identity)",
};

const EMAIL_VERIFIED_LABELS: Record<"true" | "false" | "user_choice", string> = {
  true: "Always verified",
  false: "Always unverified",
  user_choice: "Allow QA to choose",
};

export function UpdateAuthStrategiesForm({
  clientId,
  canEdit,
  initialStrategies,
}: {
  clientId: string;
  canEdit: boolean;
  initialStrategies: ClientAuthStrategies;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const form = useForm<z.infer<typeof authStrategiesSchema>>({
    resolver: zodResolver(authStrategiesSchema),
    defaultValues: initialStrategies,
  });
  const watchedStrategies = useWatch({ control: form.control }) as z.infer<typeof authStrategiesSchema> | undefined;

  useEffect(() => {
    form.reset(initialStrategies);
  }, [initialStrategies, form]);

  const handleSubmit = form.handleSubmit(
    (values) => {
      startTransition(async () => {
        const result = await updateClientAuthStrategiesAction({ clientId, ...values });
        if (result.error) {
          toast({ variant: "destructive", title: "Unable to update", description: result.error });
          return;
        }
        router.refresh();
        toast({ title: "Auth strategies updated" });
      });
    },
    () => undefined,
  );

  const renderStrategySection = (key: keyof ClientAuthStrategies) => {
    const isStrategyEnabled = watchedStrategies?.[key]?.enabled ?? false;
    const triggerTestId = `strategy-${key}-subsource`;
    return (
      <div key={key} className="rounded-md border p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h4 className="text-sm font-semibold text-foreground">{strategyMetadata[key].title}</h4>
            <p className="text-xs text-muted-foreground">{strategyMetadata[key].description}</p>
          </div>
          <FormField
            control={form.control}
            name={`${key}.enabled` as const}
            render={({ field }) => (
              <FormItem className="flex items-center gap-2">
                <FormControl>
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border border-muted"
                    checked={field.value}
                    onChange={(event) => field.onChange(event.target.checked)}
                    disabled={!canEdit || pending}
                    data-testid={`strategy-${key}-enabled`}
                  />
                </FormControl>
                <FormLabel className="text-xs text-muted-foreground">Enabled</FormLabel>
              </FormItem>
            )}
          />
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name={`${key}.subSource` as const}
            render={({ field }) => {
              const selectDisabled = !canEdit || pending || !isStrategyEnabled;
              const handleChange = (nextValue: string) => {
                if (!nextValue) {
                  return;
                }
                field.onChange(nextValue);
              };
              return (
                <FormItem>
                  <FormLabel htmlFor={triggerTestId}>Subject source</FormLabel>
                  <Select
                    value={field.value}
                    defaultValue={field.value}
                    onValueChange={handleChange}
                    disabled={selectDisabled}
                  >
                    <FormControl>
                      <SelectTrigger
                        id={triggerTestId}
                        data-testid={triggerTestId}
                        aria-label={`${strategyMetadata[key].title} subject source`}
                        disabled={selectDisabled}
                      >
                        <span className={cn("truncate", !field.value && "text-muted-foreground")}>
                          {field.value ? SUBJECT_SOURCE_LABELS[field.value] : "Select subject source"}
                        </span>
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="entered">Use entered value</SelectItem>
                      <SelectItem value="generated_uuid">Generate UUID (stable per identity)</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              );
            }}
          />
          {key === "email" ? (
            <FormField
              control={form.control}
              name={"email.emailVerifiedMode" as const}
              render={({ field }) => {
                const selectDisabled = !canEdit || pending || !isStrategyEnabled;
                const handleChange = (nextValue: string) => {
                  if (!nextValue) {
                    return;
                  }
                  field.onChange(nextValue);
                };
                return (
                  <FormItem>
                    <FormLabel htmlFor="strategy-email-verified-mode">Email verified mode</FormLabel>
                    <Select
                      value={field.value}
                      defaultValue={field.value}
                      onValueChange={handleChange}
                      disabled={selectDisabled}
                    >
                      <FormControl>
                      <SelectTrigger
                        id="strategy-email-verified-mode"
                        data-testid="strategy-email-verified-mode"
                        aria-label="Email verified mode"
                        disabled={selectDisabled}
                      >
                        <span className={cn("truncate", !field.value && "text-muted-foreground")}>
                          {field.value ? EMAIL_VERIFIED_LABELS[field.value] : "Select email verified mode"}
                        </span>
                      </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="true">Always verified</SelectItem>
                        <SelectItem value="false">Always unverified</SelectItem>
                        <SelectItem value="user_choice">Allow QA to choose</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                );
              }}
            />
          ) : null}
        </div>
        <p className="mt-4 text-xs text-muted-foreground">
          {key === "email"
            ? "Email strategy returns email claims gated by the email scope and sets email_verified per the selected mode."
            : "Username strategy returns preferred_username gated by the profile scope."}
        </p>
      </div>
    );
  };

  return (
    <Form {...form}>
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="grid gap-4 lg:grid-cols-2">{(Object.keys(strategyMetadata) as (keyof ClientAuthStrategies)[]).map(renderStrategySection)}</div>
        {form.formState.errors.root?.message ? (
          <p className="text-sm text-destructive">{form.formState.errors.root.message}</p>
        ) : null}
        <Button type="submit" disabled={!canEdit || pending} className="w-full sm:w-auto">
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save strategies"}
        </Button>
      </form>
    </Form>
  );
}

export function DeleteRedirectButton({ redirectId, canEdit }: { redirectId: string; canEdit: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  const handleDelete = () => {
    startTransition(async () => {
      const result = await deleteRedirectUriAction({ redirectId });
      if (result.error) {
        toast({ variant: "destructive", title: "Unable to remove", description: result.error });
        return;
      }
      toast({ title: "Redirect removed" });
      router.refresh();
    });
  };

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="text-destructive"
      onClick={handleDelete}
      disabled={pending || !canEdit}
    >
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
      {!pending && <span className="ml-1 text-sm">Remove</span>}
    </Button>
  );
}

type IssuerOption = {
  id: string;
  label: string;
};

export function UpdateClientIssuerForm({
  clientId,
  canEdit,
  defaultResourceId,
  defaultResourceName,
  currentResourceId,
  usesDefault,
  resources,
}: {
  clientId: string;
  canEdit: boolean;
  defaultResourceId: string;
  defaultResourceName: string;
  currentResourceId: string | null;
  usesDefault: boolean;
  resources: IssuerOption[];
}) {
  const router = useRouter();
  const [pending, startSaveTransition] = useTransition();
  const { toast } = useToast();

  const tenantDefaultLabel = `Tenant default (${defaultResourceName})`;
  const options: IssuerOption[] = [
    { id: "default", label: tenantDefaultLabel },
    ...resources,
  ];

  const normalizeResourceId = (resourceId: string | null | undefined) => {
    if (!resourceId || resourceId === "default") {
      return "default";
    }
    return resourceId;
  };

  const form = useForm<z.infer<typeof issuerSchema>>({
    resolver: zodResolver(issuerSchema),
    defaultValues: { resourceId: normalizeResourceId(usesDefault ? "default" : currentResourceId ?? defaultResourceId) },
  });

  useEffect(() => {
    form.reset({ resourceId: normalizeResourceId(usesDefault ? "default" : currentResourceId ?? defaultResourceId) });
  }, [currentResourceId, defaultResourceId, form, usesDefault]);

  const watchedResourceId = useWatch({ control: form.control, name: "resourceId" });
  const selectedLabel = options.find((option) => option.id === watchedResourceId)?.label ?? tenantDefaultLabel;

  const handleSubmit = form.handleSubmit((values) => {
    startSaveTransition(async () => {
      const result = await updateClientIssuerAction({ clientId, apiResourceId: values.resourceId });
      if (result.error) {
        toast({ variant: "destructive", title: "Unable to update issuer", description: result.error });
        return;
      }
      router.refresh();
      toast({ title: "Issuer updated", description: "Client now issues tokens for the selected resource." });
    });
  });

  return (
    <Form {...form}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <FormField
          control={form.control}
          name="resourceId"
          render={({ field }) => (
            <FormItem className="flex-1 space-y-2">
              <FormLabel htmlFor="client-issuer-select">Issuer / API resource</FormLabel>
              <Select
                value={field.value}
                onValueChange={(value) => {
                  if (!value) {
                    return;
                  }
                  const normalized = normalizeResourceId(value);
                  field.onChange(normalized);
                  form.setValue("resourceId", normalized, { shouldValidate: true, shouldDirty: true });
                }}
                disabled={!canEdit || pending}
              >
                <FormControl>
                  <SelectTrigger
                    className="text-left"
                    id="client-issuer-select"
                    aria-label="API resource"
                    data-testid="client-issuer-trigger"
                  >
                    <SelectValue aria-hidden="true" className="sr-only" />
                    <span className="flex-1 truncate text-left" data-testid="client-issuer-value">{selectedLabel}</span>
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {options.map((option) => (
                    <SelectItem key={option.id} value={option.id} data-testid={`issuer-option-${option.id}`}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button
          type="submit"
          disabled={!canEdit || pending}
          className="sm:w-auto w-full"
          data-testid="issuer-form-save"
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
        </Button>
      </form>
    </Form>
  );
}
