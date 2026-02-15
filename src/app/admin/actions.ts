'use server';

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { getServerSession } from "next-auth";
import { z } from "zod";

import { authOptions } from "@/server/auth/options";
import { prisma } from "@/server/db/client";
import { addRedirectUri, createClient } from "@/server/services/client-service";
import { rotateKey } from "@/server/services/key-service";
import { findOrCreateMockUser } from "@/server/services/mock-user-service";
import { createTenant, assertTenantMembership } from "@/server/services/tenant-service";

const tenantSchema = z.object({
  name: z.string().min(2),
  slug: z.string().regex(/^[a-z0-9-]+$/),
});

const clientSchema = z.object({
  tenantId: z.string().cuid(),
  name: z.string().min(2),
  type: z.enum(["PUBLIC", "CONFIDENTIAL"]),
});

const redirectSchema = z.object({
  clientId: z.string().cuid(),
  uri: z.string().min(1),
});

const mockUserSchema = z.object({
  tenantId: z.string().cuid(),
  username: z.string().min(1),
});

const keySchema = z.object({ tenantId: z.string().cuid() });

const setTenantSchema = z.object({ slug: z.string().min(1) });

const requireSession = async () => {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }
  return session.user.id;
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
      slug: formData.get("slug"),
    });
    const tenant = await createTenant(adminId, parsed);
    const cookieStore = await cookies();
    cookieStore.set("admin_active_tenant", tenant.slug, { path: "/" });
    revalidatePath("/admin");
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
    const parsed = setTenantSchema.parse({ slug: formData.get("slug") });
    const tenant = await prisma.tenant.findUnique({ where: { slug: parsed.slug } });
    if (!tenant) {
      return { error: "Tenant not found" };
    }
    await assertTenantMembership(adminId, tenant.id);
    const cookieStore = await cookies();
    cookieStore.set("admin_active_tenant", parsed.slug, { path: "/" });
    revalidatePath("/admin");
    return { success: "Active tenant updated" };
  } catch {
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
    const { client, clientSecret } = await createClient(parsed.tenantId, {
      name: parsed.name,
      clientType: parsed.type,
    });
    revalidatePath("/admin");
    return {
      success: "Client created",
      data: { clientId: client.clientId, clientSecret: clientSecret ?? undefined },
    };
  } catch (error) {
    console.error(error);
    return { error: "Failed to create client" };
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
    const client = await prisma.client.findUnique({ where: { id: parsed.clientId } });
    if (!client) {
      return { error: "Client not found" };
    }
    await assertTenantMembership(adminId, client.tenantId);
    await addRedirectUri(parsed.clientId, parsed.uri);
    revalidatePath("/admin");
    return { success: "Redirect URI saved" };
  } catch (error) {
    console.error(error);
    return { error: "Failed to add redirect" };
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
    revalidatePath("/admin");
    return { success: "Signing key rotated" };
  } catch (error) {
    console.error(error);
    return { error: "Unable to rotate key" };
  }
};

export const createMockUserAction = async (
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> => {
  try {
    const adminId = await requireSession();
    const parsed = mockUserSchema.parse({
      tenantId: formData.get("tenantId"),
      username: formData.get("username"),
    });
    await assertTenantMembership(adminId, parsed.tenantId);
    await findOrCreateMockUser(parsed.tenantId, parsed.username);
    revalidatePath("/admin");
    return { success: "Mock user ready" };
  } catch (error) {
    console.error(error);
    return { error: "Unable to create user" };
  }
};
