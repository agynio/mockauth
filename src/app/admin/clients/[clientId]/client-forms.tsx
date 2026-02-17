"use client";

import { useEffect, useRef } from "react";
import { useFormState, useFormStatus } from "react-dom";

import type { ActionState } from "@/app/admin/actions";
import {
  addRedirectUriAction,
  deleteRedirectUriAction,
  rotateClientSecretAction,
  updateClientNameAction,
} from "@/app/admin/actions";
import { CopyField } from "@/app/admin/_components/copy-field";

const defaultState: ActionState = {};
const secretState: ActionState<{ clientSecret: string }> = {};

export function UpdateClientNameForm({ clientId, initialName }: { clientId: string; initialName: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, formAction] = useFormState(updateClientNameAction, defaultState);

  useEffect(() => {
    if (state.success) {
      inputRef.current?.blur();
    }
  }, [state.success]);

  return (
    <form action={formAction} className="space-y-2 sm:flex sm:items-center sm:gap-3 sm:space-y-0">
      <input type="hidden" name="clientId" value={clientId} />
      <input
        ref={inputRef}
        name="name"
        defaultValue={initialName}
        minLength={2}
        required
        className="flex-1 rounded-xl border border-white/10 bg-slate-900/60 px-4 py-2 text-white"
      />
      <SubmitButton label="Save" />
      {state.error && <p className="text-xs text-red-400">{state.error}</p>}
      {state.success && <p className="text-xs text-emerald-400">{state.success}</p>}
    </form>
  );
}

export function RotateSecretForm({ clientId }: { clientId: string }) {
  const [state, formAction] = useFormState(rotateClientSecretAction, secretState);

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="clientId" value={clientId} />
      {state.error && <p className="text-xs text-red-400">{state.error}</p>}
      {state.data?.clientSecret && (
        <CopyField
          label="New client secret"
          value={state.data.clientSecret}
          description="Copy immediately—this value is only shown once."
        />
      )}
      <SubmitButton label="Rotate secret" />
    </form>
  );
}

export function AddRedirectForm({ clientId }: { clientId: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, formAction] = useFormState(addRedirectUriAction, defaultState);

  useEffect(() => {
    if (state.success && inputRef.current) {
      inputRef.current.value = "";
    }
  }, [state.success]);

  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="clientId" value={clientId} />
      <div className="flex gap-2">
        <input
          ref={inputRef}
          type="url"
          name="uri"
          required
          placeholder="https://app.example.com/callback"
          className="flex-1 rounded-lg border border-white/10 bg-slate-900/60 px-3 py-2 text-sm text-white"
        />
        <SubmitButton label="Add" />
      </div>
      {state.error && <p className="text-xs text-red-400">{state.error}</p>}
      {state.success && <p className="text-xs text-emerald-400">{state.success}</p>}
    </form>
  );
}

export function DeleteRedirectButton({ redirectId }: { redirectId: string }) {
  const deleteAction = async (formData: FormData) => {
    await deleteRedirectUriAction(defaultState, formData);
  };
  return (
    <form action={deleteAction}>
      <input type="hidden" name="redirectId" value={redirectId} />
      <DeleteButton />
    </form>
  );
}

function DeleteButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="text-xs text-red-300 hover:text-red-200 disabled:cursor-wait disabled:text-slate-600"
    >
      Remove
    </button>
  );
}

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-xl bg-amber-400 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-amber-300 disabled:cursor-wait disabled:bg-slate-700 disabled:text-slate-300"
    >
      {pending ? "Working…" : label}
    </button>
  );
}
