'use client';

import { useFormState } from "react-dom";

import type { ActionState } from "@/app/admin/actions";
import {
  addRedirectUriAction,
  createClientAction,
  createMockUserAction,
  createTenantAction,
  rotateKeyAction,
  setActiveTenantAction,
} from "@/app/admin/actions";

const initialState: ActionState = {};
const clientInitialState: ActionState<{ clientId: string; clientSecret?: string }> = {};

export function CreateTenantForm() {
  const [state, formAction] = useFormState(createTenantAction, initialState);

  return (
    <form action={formAction} className="space-y-3">
      <div>
        <label className="text-sm text-slate-300">Tenant name</label>
        <input name="name" required className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2" />
      </div>
      <div>
        <label className="text-sm text-slate-300">Slug</label>
        <input name="slug" required pattern="[a-z0-9-]+" className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2" />
      </div>
      <button type="submit" className="rounded-md bg-amber-400 px-3 py-2 font-semibold text-slate-900">Create tenant</button>
      {state.error && <p className="text-sm text-red-400">{state.error}</p>}
      {state.success && <p className="text-sm text-emerald-400">{state.success}</p>}
    </form>
  );
}

export function SetActiveTenantButton({ slug }: { slug: string }) {
  const [state, formAction] = useFormState(setActiveTenantAction, initialState);
  return (
    <form action={formAction}>
      <input type="hidden" name="slug" value={slug} />
      <button type="submit" className="text-xs font-medium text-amber-300">Set active</button>
      {state.error && <p className="text-xs text-red-400">{state.error}</p>}
    </form>
  );
}

export function CreateClientForm({ tenantId }: { tenantId: string }) {
  const [state, formAction] = useFormState(createClientAction, clientInitialState);
  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="tenantId" value={tenantId} />
      <div>
        <label className="text-sm text-slate-300">Name</label>
        <input name="name" required className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2" />
      </div>
      <div>
        <label className="text-sm text-slate-300">Client type</label>
        <select name="type" className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2">
          <option value="CONFIDENTIAL">Confidential (secret required)</option>
          <option value="PUBLIC">Public (PKCE only)</option>
        </select>
      </div>
      <button type="submit" className="rounded-md bg-amber-400 px-3 py-2 font-semibold text-slate-900">Create client</button>
      {state.error && <p className="text-sm text-red-400">{state.error}</p>}
      {state.success && state.data && (
        <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-200">
          <p><span className="font-medium">Client ID:</span> {state.data.clientId}</p>
          {state.data.clientSecret && <p><span className="font-medium">Client secret:</span> {state.data.clientSecret}</p>}
        </div>
      )}
    </form>
  );
}

export function AddRedirectForm({ clientId }: { clientId: string }) {
  const [state, formAction] = useFormState(addRedirectUriAction, initialState);
  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="clientId" value={clientId} />
      <input
        name="uri"
        placeholder="https://app.example.test/callback"
        className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2"
        required
      />
      <button type="submit" className="rounded-md bg-slate-800 px-3 py-2 text-sm">Add redirect</button>
      {state.error && <p className="text-xs text-red-400">{state.error}</p>}
      {state.success && <p className="text-xs text-emerald-400">{state.success}</p>}
    </form>
  );
}

export function RotateKeyForm({ tenantId }: { tenantId: string }) {
  const [state, formAction] = useFormState(rotateKeyAction, initialState);
  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="tenantId" value={tenantId} />
      <button type="submit" className="rounded-md bg-slate-800 px-3 py-2 text-sm">Rotate signing key</button>
      {state.error && <p className="text-xs text-red-400">{state.error}</p>}
      {state.success && <p className="text-xs text-emerald-400">{state.success}</p>}
    </form>
  );
}

export function CreateMockUserForm({ tenantId }: { tenantId: string }) {
  const [state, formAction] = useFormState(createMockUserAction, initialState);
  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="tenantId" value={tenantId} />
      <input name="username" placeholder="qa-user" className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2" required />
      <button type="submit" className="rounded-md bg-slate-800 px-3 py-2 text-sm">Add mock user</button>
      {state.error && <p className="text-xs text-red-400">{state.error}</p>}
      {state.success && <p className="text-xs text-emerald-400">{state.success}</p>}
    </form>
  );
}
