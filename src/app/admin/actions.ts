"use server";

import { randomBytes, randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { getServerSession } from "next-auth";
import { z } from "zod";

import { addHours, addMinutes } from "date-fns";

import type { MembershipRole } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";
import { authOptions } from "@/server/auth/options";
import {
  addRedirectUri,
  createClient,
  rotateClientSecret,
  updateClientName,
  updateClientApiResource,
  updateClientAuthStrategies,
} from "@/server/services/client-service";
import { rotateKey } from "@/server/services/key-service";
import {
  ADMIN_ACTIVE_TENANT_COOKIE,
  clearAdminActiveTenantCookie,
  setAdminActiveTenantCookie,
} from "@/server/services/admin-tenant-context";
import {
  assertTenantMembership,
  assertTenantRole,
  ensureMembershipRole,
  createTenant,
  deleteTenant,
  getTenantMemberships,
} from "@/server/services/tenant-service";
import { createInvite, removeMember, revokeInvite, updateMemberRole } from "@/server/services/membership-service";
import {
  createApiResource,
  updateApiResource as updateApiResourceRecord,
  setDefaultApiResource,
  getApiResourceForTenant,
} from "@/server/services/api-resource-service";
import { hasEnabledStrategy } from "@/server/oidc/auth-strategy";
import { computeS256Challenge } from "@/server/crypto/pkce";
import { getRequestOrigin } from "@/server/utils/request-origin";
import { buildOidcUrls } from "@/server/oidc/url-builder";
import { resolveRedirectUri } from "@/server/oidc/redirect-uri";
import { createOauthTestSession } from "@/server/services/oauth-test-service";

const tenantSchema = z.object({
  name: z.string().min(2, "Tenant name must include at least two characters"),
});

const clientSchema = z.object({
  tenantId: z.string().min(1),
  name: z.string().min(2),
  type: z.enum(["PUBLIC", "CONFIDENTIAL"]),
  redirects: z.array(z.string().min(1)).optional(),
});

const keySchema = z.object({ tenantId: z.string().min(1) });
const setTenantSchema = z.object({ tenantId: z.string().min(1) });
const rotateSecretSchema = z.object({ clientId: z.string().min(1) });
const redirectSchema = z.object({ clientId: z.string().min(1), uri: z.string().min(1) });
const oauthTestSchema = z.object({
  clientId: z.string().min(1),
  redirectUri: z.string().min(1),
  scopes: z.string().min(1),
  clientSecret: z.string().optional().nullable(),
});
const updateClientSchema = z.object({ clientId: z.string().min(1), name: z.string().min(2) });
const deleteRedirectSchema = z.object({ redirectId: z.string().min(1) });
const membershipRoleSchema = z.enum(["OWNER", "WRITER", "READER"]);
const inviteRoleSchema = z.enum(["WRITER", "READER"]);
const deleteTenantSchema = z.object({ tenantId: z.string().min(1) });
const updateMemberRoleSchema = z.object({
  tenantId: z.string().min(1),
  membershipId: z.string().min(1),
  role: membershipRoleSchema,
});
const removeMemberSchema = z.object({ tenantId: z.string().min(1), membershipId: z.string().min(1) });
const createInviteSchema = z.object({
  tenantId: z.string().min(1),
  role: inviteRoleSchema,
  expiresInHours: z.enum(["1", "24", "168"]),
});
const revokeInviteSchema = z.object({ tenantId: z.string().min(1), inviteId: z.string().min(1) });
const apiResourceSchema = z.object({
  tenantId: z.string().min(1),
  name: z.string().min(2),
  description: z.string().max(200).optional().nullable(),
});
const updateApiResourceSchema = apiResourceSchema.extend({ apiResourceId: z.string().min(1) });
const setDefaultResourceSchema = z.object({ tenantId: z.string().min(1), apiResourceId: z.string().min(1) });
const updateClientIssuerSchema = z.object({
  clientId: z.string().min(1),
  apiResourceId: z.union([z.literal("default"), z.string().min(1)]),
});
const subjectSourceSchema = z.enum(["entered", "generated_uuid"]);
const emailVerifiedModeSchema = z.enum(["true", "false", "user_choice"]);
const strategyConfigSchema = z.object({ enabled: z.boolean(), subSource: subjectSourceSchema });
const emailStrategyConfigSchema = strategyConfigSchema.extend({ emailVerifiedMode: emailVerifiedModeSchema });
const updateClientStrategiesSchema = z.object({
  clientId: z.string().min(1),
  username: strategyConfigSchema,
  email: emailStrategyConfigSchema,
});

const requireSession = async () => {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }
  return session.user.id;
};

const clientPath = (clientId: string) => `/admin/clients/${clientId}`;

const getClientForAdmin = async (clientId: string, adminId: string, allowedRoles?: MembershipRole[]) => {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { id: true, tenantId: true, clientType: true },
  });
  if (!client) {
    return null;
  }
  const membership = await assertTenantMembership(adminId, client.tenantId);
  if (allowedRoles) {
    ensureMembershipRole(membership.role, allowedRoles);
  }
  return client;
};

export type ActionState<T = undefined> = {
  error?: string;
  success?: string;
  data?: T;
};

export const createTenantAction = async (input: z.infer<typeof tenantSchema>): Promise<ActionState> => {
  try {
    const adminId = await requireSession();
    const parsed = tenantSchema.parse(input);
    const tenant = await createTenant(adminId, parsed);
    await setAdminActiveTenantCookie(tenant.id);
    revalidatePath("/admin", "layout");
    revalidatePath("/admin/clients");
    revalidatePath("/admin/members");
    return { success: "Tenant created" };
  } catch (error) {
    console.error(error);
    return { error: "Failed to create tenant" };
  }
};

export const setActiveTenantAction = async (input: z.infer<typeof setTenantSchema>): Promise<ActionState> => {
  try {
    const adminId = await requireSession();
    const parsed = setTenantSchema.parse(input);
    await assertTenantMembership(adminId, parsed.tenantId);
    await setAdminActiveTenantCookie(parsed.tenantId);
    revalidatePath("/admin", "layout");
    revalidatePath("/admin/clients");
    revalidatePath("/admin/members");
    return { success: "Active tenant updated" };
  } catch (error) {
    console.error(error);
    return { error: "Unable to set tenant" };
  }
};

export const createClientAction = async (
  input: z.infer<typeof clientSchema>,
): Promise<ActionState<{ clientId: string; clientSecret?: string }>> => {
  try {
    const adminId = await requireSession();
    const parsed = clientSchema.parse(input);
    const membership = await assertTenantMembership(adminId, parsed.tenantId);
    ensureMembershipRole(membership.role, ["OWNER", "WRITER"]);
    const redirectEntries = parsed.redirects?.filter(Boolean);
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

export const createApiResourceAction = async (input: z.infer<typeof apiResourceSchema>): Promise<ActionState> => {
  try {
    const adminId = await requireSession();
    const parsed = apiResourceSchema.parse(input);
    const membership = await assertTenantMembership(adminId, parsed.tenantId);
    ensureMembershipRole(membership.role, ["OWNER", "WRITER"]);
    await createApiResource(parsed.tenantId, { name: parsed.name, description: parsed.description });
    revalidatePath("/admin/api-resources");
    revalidatePath("/admin/clients");
    return { success: "API resource created" };
  } catch (error) {
    console.error(error);
    return { error: "Failed to create API resource" };
  }
};

export const updateApiResourceAction = async (input: z.infer<typeof updateApiResourceSchema>): Promise<ActionState> => {
  try {
    const adminId = await requireSession();
    const parsed = updateApiResourceSchema.parse(input);
    const membership = await assertTenantMembership(adminId, parsed.tenantId);
    ensureMembershipRole(membership.role, ["OWNER", "WRITER"]);
    await updateApiResourceRecord(parsed.tenantId, parsed.apiResourceId, {
      name: parsed.name,
      description: parsed.description,
    });
    revalidatePath("/admin/api-resources");
    revalidatePath("/admin/clients");
    return { success: "API resource updated" };
  } catch (error) {
    console.error(error);
    return { error: "Unable to update API resource" };
  }
};

export const setDefaultApiResourceAction = async (
  input: z.infer<typeof setDefaultResourceSchema>,
): Promise<ActionState> => {
  try {
    const adminId = await requireSession();
    const parsed = setDefaultResourceSchema.parse(input);
    const membership = await assertTenantMembership(adminId, parsed.tenantId);
    ensureMembershipRole(membership.role, ["OWNER", "WRITER"]);
    await setDefaultApiResource(parsed.tenantId, parsed.apiResourceId);
    revalidatePath("/admin/api-resources");
    revalidatePath("/admin/clients");
    revalidatePath("/admin", "layout");
    return { success: "Default issuer updated" };
  } catch (error) {
    console.error(error);
    return { error: "Unable to set default resource" };
  }
};

export const rotateKeyAction = async (input: z.infer<typeof keySchema>): Promise<ActionState> => {
  try {
    const adminId = await requireSession();
    const parsed = keySchema.parse(input);
    await assertTenantRole(adminId, parsed.tenantId, ["OWNER"]);
    await rotateKey(parsed.tenantId);
    revalidatePath("/admin", "layout");
    return { success: "Signing key rotated" };
  } catch (error) {
    console.error(error);
    return { error: "Unable to rotate key" };
  }
};

export const rotateClientSecretAction = async (
  input: z.infer<typeof rotateSecretSchema>,
): Promise<ActionState<{ clientSecret: string }>> => {
  try {
    const adminId = await requireSession();
    const parsed = rotateSecretSchema.parse(input);
    const client = await getClientForAdmin(parsed.clientId, adminId, ["OWNER", "WRITER"]);
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

export const addRedirectUriAction = async (input: z.infer<typeof redirectSchema>): Promise<ActionState> => {
  try {
    const adminId = await requireSession();
    const parsed = redirectSchema.parse(input);
    const client = await getClientForAdmin(parsed.clientId, adminId, ["OWNER", "WRITER"]);
    if (!client) {
      return { error: "Client not found" };
    }
    await addRedirectUri(client.id, parsed.uri);
    revalidatePath(clientPath(client.id));
    revalidatePath(`${clientPath(client.id)}/test`);
    return { success: "Redirect URI saved" };
  } catch (error) {
    console.error(error);
    return { error: "Failed to add redirect" };
  }
};

export const prepareClientOauthTestAction = async (
  input: z.infer<typeof oauthTestSchema>,
): Promise<ActionState<{ authorizationUrl: string }>> => {
  try {
    const adminId = await requireSession();
    const parsed = oauthTestSchema.parse(input);
    const client = await prisma.client.findUnique({
      where: { id: parsed.clientId },
      include: {
        tenant: { include: { defaultApiResource: true } },
        apiResource: true,
        redirectUris: true,
      },
    });
    if (!client) {
      return { error: "Client not found" };
    }

    await assertTenantMembership(adminId, client.tenantId);

    const redirectUri = parsed.redirectUri.trim();
    const normalizedScopes = parsed.scopes
      .split(/\s+/)
      .map((scope) => scope.trim())
      .filter(Boolean)
      .join(" ");
    if (!normalizedScopes) {
      return { error: "Enter at least one scope" };
    }

    try {
      resolveRedirectUri(redirectUri, client.redirectUris);
    } catch {
      return { error: "Redirect URI must be saved on the client before testing" };
    }

    const requiresSecret = client.tokenEndpointAuthMethod !== "none";
    const clientSecret = parsed.clientSecret?.trim() || null;
    if (requiresSecret && !clientSecret) {
      return { error: "Client secret is required for this client" };
    }

    const codeVerifier = randomBytes(32).toString("base64url");
    const codeChallenge = computeS256Challenge(codeVerifier);
    const state = randomUUID();
    const nonce = randomBytes(16).toString("base64url");
    const expiresAt = addMinutes(new Date(), 10);

    await createOauthTestSession({
      id: state,
      clientId: client.id,
      tenantId: client.tenantId,
      redirectUri,
      scopes: normalizedScopes,
      codeVerifier,
      clientSecret,
      nonce,
      expiresAt,
    });

    const origin = await getRequestOrigin();
    const resourceId = client.apiResourceId ?? client.tenant.defaultApiResourceId;
    if (!resourceId) {
      return { error: "Client is missing a default API resource" };
    }
    const { authorize } = buildOidcUrls(origin, resourceId);
    const authorizeUrl = new URL(authorize);
    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("client_id", client.clientId);
    authorizeUrl.searchParams.set("redirect_uri", redirectUri);
    authorizeUrl.searchParams.set("scope", normalizedScopes);
    authorizeUrl.searchParams.set("state", state);
    authorizeUrl.searchParams.set("code_challenge", codeChallenge);
    authorizeUrl.searchParams.set("code_challenge_method", "S256");
    authorizeUrl.searchParams.set("nonce", nonce);

    return { success: "Authorization URL generated", data: { authorizationUrl: authorizeUrl.toString() } };
  } catch (error) {
    console.error(error);
    return { error: "Unable to start OAuth test" };
  }
};

export const updateClientNameAction = async (input: z.infer<typeof updateClientSchema>): Promise<ActionState> => {
  try {
    const adminId = await requireSession();
    const parsed = updateClientSchema.parse(input);
    const client = await getClientForAdmin(parsed.clientId, adminId, ["OWNER", "WRITER"]);
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

export const updateClientIssuerAction = async (
  input: z.infer<typeof updateClientIssuerSchema>,
): Promise<ActionState> => {
  try {
    const adminId = await requireSession();
    const parsed = updateClientIssuerSchema.parse(input);
    const client = await getClientForAdmin(parsed.clientId, adminId, ["OWNER", "WRITER"]);
    if (!client) {
      return { error: "Client not found" };
    }

    let apiResourceId: string | null = null;
    if (parsed.apiResourceId !== "default") {
      apiResourceId = parsed.apiResourceId;
      await getApiResourceForTenant(client.tenantId, apiResourceId);
    }

    await updateClientApiResource(client.id, apiResourceId);
    revalidatePath(clientPath(client.id));
    revalidatePath("/admin/clients");
    return { success: "Client issuer updated" };
  } catch (error) {
    console.error(error);
    return { error: "Unable to update issuer" };
  }
};

export const updateClientAuthStrategiesAction = async (
  input: z.infer<typeof updateClientStrategiesSchema>,
): Promise<ActionState> => {
  try {
    const adminId = await requireSession();
    const parsed = updateClientStrategiesSchema.parse(input);
    const client = await getClientForAdmin(parsed.clientId, adminId, ["OWNER", "WRITER"]);
    if (!client) {
      return { error: "Client not found" };
    }
    const strategies = { username: parsed.username, email: parsed.email };
    if (!hasEnabledStrategy(strategies)) {
      return { error: "Enable at least one strategy" };
    }
    await updateClientAuthStrategies(client.id, strategies);
    revalidatePath(clientPath(client.id));
    revalidatePath("/admin/clients");
    return { success: "Auth strategies updated" };
  } catch (error) {
    console.error(error);
    return { error: "Unable to update strategies" };
  }
};

export const deleteRedirectUriAction = async (input: z.infer<typeof deleteRedirectSchema>): Promise<ActionState> => {
  try {
    const adminId = await requireSession();
    const parsed = deleteRedirectSchema.parse(input);
    const redirect = await prisma.redirectUri.findUnique({
      where: { id: parsed.redirectId },
      select: { id: true, clientId: true, client: { select: { tenantId: true } } },
    });
    if (!redirect) {
      return { error: "Redirect not found" };
    }
    const membership = await assertTenantMembership(adminId, redirect.client.tenantId);
    ensureMembershipRole(membership.role, ["OWNER", "WRITER"]);
    await prisma.redirectUri.delete({ where: { id: redirect.id } });
    revalidatePath(clientPath(redirect.clientId));
    return { success: "Redirect removed" };
  } catch (error) {
    console.error(error);
    return { error: "Unable to remove redirect" };
  }
};

export const updateMemberRoleAction = async (input: z.infer<typeof updateMemberRoleSchema>): Promise<ActionState> => {
  try {
    const adminId = await requireSession();
    const parsed = updateMemberRoleSchema.parse(input);
    await assertTenantRole(adminId, parsed.tenantId, ["OWNER"]);
    await updateMemberRole(parsed.tenantId, parsed.membershipId, parsed.role);
    revalidatePath("/admin/members");
    return { success: "Member updated" };
  } catch (error) {
    console.error(error);
    return { error: "Unable to update member" };
  }
};

export const removeMemberAction = async (input: z.infer<typeof removeMemberSchema>): Promise<ActionState> => {
  try {
    const adminId = await requireSession();
    const parsed = removeMemberSchema.parse(input);
    await assertTenantRole(adminId, parsed.tenantId, ["OWNER"]);
    await removeMember(parsed.tenantId, parsed.membershipId);
    revalidatePath("/admin/members");
    return { success: "Member removed" };
  } catch (error) {
    console.error(error);
    return { error: "Unable to remove member" };
  }
};

export const createInviteAction = async (
  input: z.infer<typeof createInviteSchema>,
): Promise<ActionState<{ inviteId: string; token: string }>> => {
  try {
    const adminId = await requireSession();
    const parsed = createInviteSchema.parse(input);
    await assertTenantRole(adminId, parsed.tenantId, ["OWNER"]);
    const expiresIn = Number(parsed.expiresInHours);
    const expiresAt = addHours(new Date(), expiresIn);
    const { invite, token } = await createInvite({
      tenantId: parsed.tenantId,
      role: parsed.role,
      createdByUserId: adminId,
      expiresAt,
    });
    revalidatePath("/admin/members");
    return { success: "Invite created", data: { inviteId: invite.id, token } };
  } catch (error) {
    console.error(error);
    return { error: "Unable to create invite" };
  }
};

export const revokeInviteAction = async (input: z.infer<typeof revokeInviteSchema>): Promise<ActionState> => {
  try {
    const adminId = await requireSession();
    const parsed = revokeInviteSchema.parse(input);
    await assertTenantRole(adminId, parsed.tenantId, ["OWNER"]);
    await revokeInvite(parsed.tenantId, parsed.inviteId);
    revalidatePath("/admin/members");
    return { success: "Invite revoked" };
  } catch (error) {
    console.error(error);
    return { error: "Unable to revoke invite" };
  }
};

export const deleteTenantAction = async (
  input: z.infer<typeof deleteTenantSchema>,
): Promise<ActionState<{ activeTenantId: string | null; remainingTenants: number }>> => {
  try {
    const adminId = await requireSession();
    const parsed = deleteTenantSchema.parse(input);
    await assertTenantRole(adminId, parsed.tenantId, ["OWNER"]);
    await deleteTenant(parsed.tenantId);

    const store = await cookies();
    const activeTenantCookie = store.get(ADMIN_ACTIVE_TENANT_COOKIE)?.value ?? null;
    const remainingMemberships = await getTenantMemberships(adminId);
    let resultingActiveTenantId = activeTenantCookie;
    if (activeTenantCookie === parsed.tenantId) {
      resultingActiveTenantId = remainingMemberships[0]?.tenantId ?? null;
      if (resultingActiveTenantId) {
        await setAdminActiveTenantCookie(resultingActiveTenantId);
      } else {
        await clearAdminActiveTenantCookie();
      }
    }

    revalidatePath("/admin", "layout");
    revalidatePath("/admin/clients");
    revalidatePath("/admin/api-resources");
    revalidatePath("/admin/members");
    return {
      success: "Tenant deleted",
      data: { activeTenantId: resultingActiveTenantId ?? null, remainingTenants: remainingMemberships.length },
    };
  } catch (error) {
    console.error(error);
    return { error: "Unable to delete tenant" };
  }
};
