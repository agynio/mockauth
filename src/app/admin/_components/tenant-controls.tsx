"use client";

import { useEffect, useRef, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";

import type { ActionState } from "@/app/admin/actions";
import { createTenantAction, setActiveTenantAction } from "@/app/admin/actions";

type TenantOption = {
  id: string;
  name: string;
};

const initialState: ActionState = {};

export function TenantSwitcher({ tenants, activeTenantId }: { tenants: TenantOption[]; activeTenantId: string | null }) {
  const [state, formAction] = useFormState(setActiveTenantAction, initialState);
  const [selected, setSelected] = useState<string>("");

  const fallback = activeTenantId ?? tenants[0]?.id ?? "";
  const hasSelected = tenants.some((tenant) => tenant.id === selected);
  const currentValue = hasSelected ? selected : fallback;
  const disabled = tenants.length === 0;

  return (
    <form action={formAction} className="space-y-2">
      <div className="flex items-center justify-between text-xs uppercase tracking-wide text-slate-400">
        <span>Active tenant</span>
        {state.error && <span className="text-red-400">{state.error}</span>}
        {state.success && <span className="text-emerald-400">{state.success}</span>}
      </div>
      <div className="flex gap-2">
        <select
          name="tenantId"
          value={currentValue}
          onChange={(event) => setSelected(event.target.value)}
          className="flex-1 rounded-md border border-white/10 bg-slate-900/60 px-3 py-2 text-sm text-white disabled:cursor-not-allowed disabled:opacity-50"
          disabled={disabled}
        >
          {disabled ? <option value="">No tenants available</option> : null}
          {tenants.map((tenant) => (
            <option key={tenant.id} value={tenant.id}>
              {tenant.name}
            </option>
          ))}
        </select>
        <SubmitButton disabled={!currentValue || disabled} label="Switch" />
      </div>
    </form>
  );
}

export function CreateTenantForm() {
  const [state, formAction] = useFormState(createTenantAction, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.success) {
      formRef.current?.reset();
    }
  }, [state.success]);

  return (
    <form ref={formRef} action={formAction} className="space-y-2">
      <div className="flex items-center justify-between text-xs uppercase tracking-wide text-slate-400">
        <span>Add tenant</span>
        {state.error && <span className="text-red-400">{state.error}</span>}
        {state.success && <span className="text-emerald-400">{state.success}</span>}
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          name="name"
          required
          minLength={2}
          placeholder="Acme Corp"
          className="flex-1 rounded-md border border-white/10 bg-slate-900/60 px-3 py-2 text-sm text-white placeholder:text-slate-500"
        />
        <SubmitButton disabled={false} label="Add" />
      </div>
    </form>
  );
}

function SubmitButton({ disabled = false, label }: { disabled?: boolean; label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={disabled || pending}
      className="rounded-md bg-amber-400/90 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-300"
    >
      {pending ? "..." : label}
    </button>
  );
}
