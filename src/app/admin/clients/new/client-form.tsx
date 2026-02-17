"use client";

import { useEffect, useRef } from "react";
import { useFormState, useFormStatus } from "react-dom";

import type { ActionState } from "@/app/admin/actions";
import { createClientAction } from "@/app/admin/actions";
import { CopyField } from "@/app/admin/_components/copy-field";

const initialState: ActionState<{ clientId: string; clientSecret?: string }> = {};

export function NewClientForm({ tenantId }: { tenantId: string }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction] = useFormState(createClientAction, initialState);

  useEffect(() => {
    if (state.success && formRef.current) {
      formRef.current.reset();
    }
  }, [state.success]);

  return (
    <form ref={formRef} action={formAction} className="space-y-6">
      <input type="hidden" name="tenantId" value={tenantId} />
      <div className="space-y-2">
        <label className="text-sm font-medium text-white">Client name</label>
        <input
          name="name"
          required
          minLength={2}
          placeholder="Demo SPA"
          className="w-full rounded-xl border border-white/10 bg-slate-900/70 px-4 py-2 text-white placeholder:text-slate-500"
        />
      </div>
      <div className="space-y-3">
        <p className="text-sm font-medium text-white">Client type</p>
        <div className="grid gap-3 md:grid-cols-2">
          <ClientTypeOption
            label="Confidential"
            description="Server-based apps that can safely store client secrets."
            value="CONFIDENTIAL"
            defaultChecked
          />
          <ClientTypeOption
            label="Public"
            description="Browser or native apps that perform PKCE with no secret."
            value="PUBLIC"
          />
        </div>
      </div>
      <div className="space-y-2">
        <label className="text-sm font-medium text-white">Redirect URIs</label>
        <textarea
          name="redirects"
          rows={4}
          placeholder="https://client.example.test/callback"
          className="w-full rounded-xl border border-white/10 bg-slate-900/70 px-4 py-2 text-sm text-white placeholder:text-slate-500"
        />
        <p className="text-xs text-slate-400">Enter one URI per line. Wildcards are automatically inferred.</p>
      </div>
      {state.error && <p className="text-sm text-red-400">{state.error}</p>}
      {state.success && <p className="text-sm text-emerald-400">{state.success}</p>}
      <SubmitButton label="Create client" />
      {state.data && (
        <div className="space-y-4 rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-5">
          <h3 className="text-sm font-semibold text-emerald-200">Credentials</h3>
          <CopyField label="Client ID" value={state.data.clientId} />
          {state.data.clientSecret ? (
            <CopyField
              label="Client secret"
              value={state.data.clientSecret}
              description="Secret is shown only once. Store it securely."
            />
          ) : (
            <p className="text-xs text-slate-400">Public clients do not use client secrets.</p>
          )}
        </div>
      )}
    </form>
  );
}

function ClientTypeOption({
  label,
  description,
  value,
  defaultChecked,
}: {
  label: string;
  description: string;
  value: "PUBLIC" | "CONFIDENTIAL";
  defaultChecked?: boolean;
}) {
  return (
    <label className="flex cursor-pointer flex-col gap-1 rounded-xl border border-white/10 bg-slate-900/40 p-4 text-left hover:border-amber-300/40">
      <div className="flex items-center gap-2">
        <input type="radio" name="type" value={value} defaultChecked={defaultChecked} className="h-4 w-4" />
        <span className="text-sm font-semibold text-white">{label}</span>
      </div>
      <p className="text-xs text-slate-400">{description}</p>
    </label>
  );
}

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex w-full items-center justify-center rounded-xl bg-amber-400 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-amber-300 disabled:cursor-wait"
    >
      {pending ? "Creating…" : label}
    </button>
  );
}
