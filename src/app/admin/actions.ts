'use server';

import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";
import { z } from "zod";

import { prisma } from "@/server/db/client";
import { authOptions } from "@/server/auth/options";
import { addRedirectUri, createClient, rotateClientSecret, updateClientName } from "@/server/services/client-service";
import { rotateKey } from "@/server/services/key-service";
import { setAdminActiveTenantCookie } from "@/server/services/admin-tenant-context";
import { createTenant, assertTenantMembership } from "@/server/services/tenant-service";

const tenantSchema = z.object({
  name: z.string().min(2),
});

const clientSchema = z.object({
  tenantId: z.string().min(1),
  name: z.string().min(2),
  type: z.enum(["PUBLIC", "CONFIDENTIAL"]),
});

const keySchema = z.object({ tenantId: z.string().min(1) });

const setTenantSchema = z.object({ tenantId: z.string().min(1) });

const rotateSecretSchema = z.object({ clientId: z.string().min(1) });
const redirectSchema = z.object({ clientId: z.string().min(1), uri: z.string().min(1) });
const updateClientSchema = z.object({ clientId: z.string().min(1), name: z.string().min(2) });
const deleteRedirectSchema = z.object({ redirectId: z.string().min(1) });

const requireSession = async () => {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }
  return session.user.id;
};

const parseRedirectEntries = (value: FormDataEntryValue | null) => {
  if (!value) {
    return [];
  }
  return value
    .toString()
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
};

const clientPath = (clientId: string) => `/admin/clients/${clientId}`;

const getClientForAdmin = async (clientId: string, adminId: string) => {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { id: true, tenantId: true, clientType: true },
  });
  if (!client) {
    return null;
  }
  await assertTenantMembership(adminId, client.tenantId);
  return client;
};

export type ActionState<T = undefined> = {
  error?: string;
  success?: string;
  data?: T;
};

export const createTenantAction = async (
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> => {
  try {
    const adminId = await requireSession();
    const parsed = tenantSchema.parse({
      name: formData.get("name"),
    });
    const tenant = await createTenant(adminId, parsed);
    await setAdminActiveTenantCookie(tenant.id);
    revalidatePath("/admin", "layout");
    revalidatePath("/admin/clients");
    return { success: `Tenant ${tenant.name} created` };
  } catch (error) {
    console.error(error);
    return { error: "Failed to create tenant" };
  }
};

export const setActiveTenantAction = async (
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> => {
  try {
    const adminId = await requireSession();
    const parsed = setTenantSchema.parse({ tenantId: formData.get("tenantId") });
    await assertTenantMembership(adminId, parsed.tenantId);
    await setAdminActiveTenantCookie(parsed.tenantId);
    revalidatePath("/admin", "layout");
    revalidatePath("/admin/clients");
    return { success: "Active tenant updated" };
  } catch (error) {
    console.error(error);
    return { error: "Unable to set tenant" };
  }
};

export const createClientAction = async (
  _prev: ActionState<{ clientId: string; clientSecret?: string }> ,
  formData: FormData,
): Promise<ActionState<{ clientId: string; clientSecret?: string }>> => {
  try {
    const adminId = await requireSession();
    const parsed = clientSchema.parse({
      tenantId: formData.get("tenantId"),
      name: formData.get("name"),
      type: formData.get("type"),
    });
    await assertTenantMembership(adminId, parsed.tenantId);
    const redirectEntries = parseRedirectEntries(formData.get("redirects"));
    const { client, clientSecret } = await createClient(parsed.tenantId, {
      name: parsed.name,
      clientType: parsed.type,
      redirectUris: redirectEntries,
    });
    revalidatePath("/admin", "layout");
    revalidatePath("/admin/clients");
    revalidatePath(clientPath(client.id));
    return {
      success: "Client created",
      data: { clientId: client.clientId, clientSecret: clientSecret ?? undefined },
    };
  } catch (error) {
    console.error(error);
    return { error: "Failed to create client" };
  }
};

export const rotateKeyAction = async (
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> => {
  try {
    const adminId = await requireSession();
    const parsed = keySchema.parse({ tenantId: formData.get("tenantId") });
    await assertTenantMembership(adminId, parsed.tenantId);
    await rotateKey(parsed.tenantId);
    revalidatePath("/admin", "layout");
    return { success: "Signing key rotated" };
  } catch (error) {
    console.error(error);
    return { error: "Unable to rotate key" };
  }
};

export const rotateClientSecretAction = async (
  _prev: ActionState<{ clientSecret: string }>,
  formData: FormData,
): Promise<ActionState<{ clientSecret: string }>> => {
  try {
    const adminId = await requireSession();
    const parsed = rotateSecretSchema.parse({ clientId: formData.get("clientId") });
    const client = await getClientForAdmin(parsed.clientId, adminId);
    if (!client) {
      return { error: "Client not found" };
    }
    if (client.clientType !== "CONFIDENTIAL") {
      return { error: "Public clients do not use secrets" };
    }
    const clientSecret = await rotateClientSecret(client.id);
    revalidatePath(clientPath(client.id));
    return { success: "Client secret rotated", data: { clientSecret } };
  } catch (error) {
    console.error(error);
    return { error: "Unable to rotate secret" };
  }
};

export const addRedirectUriAction = async (
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> => {
  try {
    const adminId = await requireSession();
    const parsed = redirectSchema.parse({
      clientId: formData.get("clientId"),
      uri: formData.get("uri"),
    });
    const client = await getClientForAdmin(parsed.clientId, adminId);
    if (!client) {
      return { error: "Client not found" };
    }
    await addRedirectUri(client.id, parsed.uri);
    revalidatePath(clientPath(client.id));
    return { success: "Redirect URI saved" };
  } catch (error) {
    console.error(error);
    return { error: "Failed to add redirect" };
  }
};

export const updateClientNameAction = async (
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> => {
  try {
    const adminId = await requireSession();
    const parsed = updateClientSchema.parse({
      clientId: formData.get("clientId"),
      name: formData.get("name"),
    });
    const client = await getClientForAdmin(parsed.clientId, adminId);
    if (!client) {
      return { error: "Client not found" };
    }
    await updateClientName(client.id, parsed.name);
    revalidatePath(clientPath(client.id));
    revalidatePath("/admin/clients");
    return { success: "Client updated" };
  } catch (error) {
    console.error(error);
    return { error: "Unable to update client" };
  }
};

export const deleteRedirectUriAction = async (
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> => {
  try {
    const adminId = await requireSession();
    const parsed = deleteRedirectSchema.parse({ redirectId: formData.get("redirectId") });
    const redirect = await prisma.redirectUri.findUnique({
      where: { id: parsed.redirectId },
      select: { id: true, clientId: true, client: { select: { tenantId: true } } },
    });
    if (!redirect) {
      return { error: "Redirect not found" };
    }
    await assertTenantMembership(adminId, redirect.client.tenantId);
    await prisma.redirectUri.delete({ where: { id: redirect.id } });
    revalidatePath(clientPath(redirect.clientId));
    return { success: "Redirect removed" };
  } catch (error) {
    console.error(error);
    return { error: "Unable to remove redirect" };
  }
};
