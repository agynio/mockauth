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
  deleteClient,
  proxyProviderConfigSchema,
  rotateClientSecret,
  updateClientTokenConfig,
  updateClientName,
  updateClientApiResource,
  updateClientAuthStrategies,
  updateClientReauthTtl,
  updateClientAllowedScopes,
  getClientSecret,
  updateClientSigningAlgorithms,
  upsertProxyProviderConfig,
} from "@/server/services/client-service";
import type { ProxyProviderConfigInput } from "@/server/services/client-service";
import { rotateKeyForAlg } from "@/server/services/key-service";
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
import { decrypt } from "@/server/crypto/key-vault";
import { computeS256Challenge } from "@/server/crypto/pkce";
import { getRequestOrigin } from "@/server/utils/request-origin";
import { getRequestContext } from "@/server/utils/request-context";
import { buildOidcUrls } from "@/server/oidc/url-builder";
import { resolveRedirectUri } from "@/server/oidc/redirect-uri";
import { createOauthTestSession, resetOauthTestSessionsForClient } from "@/server/services/oauth-test-service";
import { clearOauthTestSecretCookie, setOauthTestSecretCookie } from "@/server/oauth/test-cookie";
import { isValidScopeValue, normalizeScopes, SUPPORTED_SCOPES } from "@/server/oidc/scopes";
import { SUPPORTED_JWT_SIGNING_ALGS } from "@/server/oidc/signing-alg";
import { emitAuditEvent } from "@/server/services/audit-service";
import { buildConfigChangedDetails, type ProxyProviderConfigSnapshot, type TokenAuthMethod } from "@/server/services/audit-event";
import { DomainError } from "@/server/errors";
import {
  TOKEN_AUTH_METHODS,
  isTokenAuthMethod,
  parseTokenAuthMethods,
  requiresClientSecret,
} from "@/server/oidc/token-auth-method";

const OAUTH_TEST_SESSION_TTL_MINUTES = 15;
const tenantSchema = z.object({
  name: z.string().min(2, "Tenant name must include at least two characters"),
});

const grantTypeOptions = ["authorization_code", "refresh_token", "password"] as const;

const clientSchema = z.object({
  tenantId: z.string().min(1),
  name: z.string().min(2),
  tokenEndpointAuthMethods: z.array(z.enum(TOKEN_AUTH_METHODS)).min(1).default(["client_secret_basic"]),
  pkceRequired: z.boolean().default(true),
  allowedGrantTypes: z.array(z.enum(grantTypeOptions)).min(1).default(["authorization_code"]),
  redirects: z.array(z.string().min(1)).optional(),
  scopes: z.array(z.string().min(1)).optional(),
  mode: z.enum(["regular", "proxy"]).default("regular"),
  proxyConfig: proxyProviderConfigSchema.optional(),
});

const normalizeProxyConfigInput = (
  config: z.infer<typeof proxyProviderConfigSchema> | undefined,
  options?: { treatUndefinedSecretAsNoChange?: boolean },
): { normalized: ProxyProviderConfigInput | undefined; keepExistingSecret: boolean } => {
  if (!config) {
    return { normalized: undefined, keepExistingSecret: false };
  }

  const rawSecret = config.upstreamClientSecret;
  const trimmedSecret = rawSecret?.trim();
  const secretProvided = typeof rawSecret === "string" && trimmedSecret && trimmedSecret.length > 0;
  const keepExistingSecret = options?.treatUndefinedSecretAsNoChange === true && !secretProvided;

  const mappingEntries = config.scopeMapping
    ? Object.entries(config.scopeMapping)
        .map(([key, raw]) => {
          const normalizedKey = key.trim();
          const scopes = Array.isArray(raw)
            ? raw.map((scope) => scope.trim()).filter(Boolean)
            : raw
                .split(/\s+/)
                .map((scope) => scope.trim())
                .filter(Boolean);
          return [normalizedKey, scopes] as [string, string[]];
        })
        .filter(([key, scopes]) => key.length > 0 && scopes.length > 0)
    : [];

  const normalized: ProxyProviderConfigInput = {
    providerType: config.providerType ?? "oidc",
    authorizationEndpoint: config.authorizationEndpoint?.trim() ?? "",
    tokenEndpoint: config.tokenEndpoint?.trim() ?? "",
    userinfoEndpoint: config.userinfoEndpoint?.trim() || undefined,
    jwksUri: config.jwksUri?.trim() || undefined,
    upstreamClientId: config.upstreamClientId?.trim() ?? "",
    upstreamClientSecret: keepExistingSecret ? undefined : trimmedSecret || undefined,
    defaultScopes: (config.defaultScopes ?? []).map((scope) => scope.trim()).filter(Boolean),
    scopeMapping: mappingEntries.length > 0 ? Object.fromEntries(mappingEntries) : undefined,
    pkceSupported: Boolean(config.pkceSupported),
    oidcEnabled: Boolean(config.oidcEnabled),
    promptPassthroughEnabled: Boolean(config.promptPassthroughEnabled),
    loginHintPassthroughEnabled: Boolean(config.loginHintPassthroughEnabled),
    passthroughTokenResponse: Boolean(config.passthroughTokenResponse),
    upstreamTokenEndpointAuthMethod: config.upstreamTokenEndpointAuthMethod ?? "client_secret_basic",
  };

  return { normalized, keepExistingSecret };
};

const decryptProxySecret = (encrypted: string | null): string | undefined => {
  if (!encrypted) {
    return undefined;
  }
  try {
    return decrypt(encrypted);
  } catch (error) {
    console.error("Unable to decrypt upstream client secret", error);
    return undefined;
  }
};

const buildProxyConfigSnapshot = (config: ProxyProviderConfigInput): ProxyProviderConfigSnapshot => {
  const scopeMapping = config.scopeMapping
    ? Object.fromEntries(
        Object.entries(config.scopeMapping).map(([key, value]) => [
          key,
          Array.isArray(value)
            ? value.map((scope) => scope.trim()).filter(Boolean)
            : value
                .split(/\s+/)
                .map((scope) => scope.trim())
                .filter(Boolean),
        ]),
      )
    : undefined;

  return {
    providerType: config.providerType,
    authorizationEndpoint: config.authorizationEndpoint,
    tokenEndpoint: config.tokenEndpoint,
    userinfoEndpoint: config.userinfoEndpoint ?? undefined,
    jwksUri: config.jwksUri ?? undefined,
    upstreamClientId: config.upstreamClientId,
    upstreamClientSecret: config.upstreamClientSecret ?? undefined,
    upstreamTokenEndpointAuthMethod: config.upstreamTokenEndpointAuthMethod ?? undefined,
    defaultScopes: config.defaultScopes ?? undefined,
    scopeMapping,
    pkceSupported: Boolean(config.pkceSupported),
    oidcEnabled: Boolean(config.oidcEnabled),
    promptPassthroughEnabled: Boolean(config.promptPassthroughEnabled),
    loginHintPassthroughEnabled: Boolean(config.loginHintPassthroughEnabled),
    passthroughTokenResponse: Boolean(config.passthroughTokenResponse),
  };
};

const validateProxyConfigInput = (config: z.infer<typeof proxyProviderConfigSchema> | undefined): string | null => {
  if (!config) {
    return "Proxy configuration is required";
  }

  if (!config.providerType) {
    return "Select a provider type";
  }

  const requiredStrings: Array<[string | undefined, string]> = [
    [config.authorizationEndpoint, "Authorization endpoint is required"],
    [config.tokenEndpoint, "Token endpoint is required"],
    [config.upstreamClientId, "Provider client ID is required"],
  ];

  for (const [value, message] of requiredStrings) {
    if (!value || value.trim().length === 0) {
      return message;
    }
  }

  const urlChecks: Array<[string | undefined, string]> = [
    [config.authorizationEndpoint, "Authorization endpoint must be a valid URL"],
    [config.tokenEndpoint, "Token endpoint must be a valid URL"],
    [config.userinfoEndpoint, "Userinfo endpoint must be a valid URL"],
    [config.jwksUri, "JWKS URI must be a valid URL"],
  ];

  for (const [value, message] of urlChecks) {
    if (!value || value.trim().length === 0) {
      continue;
    }
    try {
      new URL(value);
    } catch (error) {
      return message;
    }
  }

  if (config.scopeMapping) {
    for (const [appScope, providerScopes] of Object.entries(config.scopeMapping)) {
      if (!appScope.trim()) {
        return "Scope mapping keys must be non-empty";
      }
      const scopesArray = Array.isArray(providerScopes)
        ? providerScopes.map((scope) => scope.trim()).filter(Boolean)
        : providerScopes
            .split(/\s+/)
            .map((scope) => scope.trim())
            .filter(Boolean);
      if (scopesArray.length === 0) {
        return `Scope mapping for ${appScope} must include provider scopes`;
      }
    }
  }

  return null;
};

const keySchema = z.object({ tenantId: z.string().min(1), alg: z.enum(SUPPORTED_JWT_SIGNING_ALGS) });
const setTenantSchema = z.object({ tenantId: z.string().min(1) });
const rotateSecretSchema = z.object({ clientId: z.string().min(1) });
const redirectSchema = z.object({ clientId: z.string().min(1), uri: z.string().min(1) });
const oauthTestSchema = z.object({
  clientId: z.string().min(1),
  redirectUri: z.string().min(1),
  scopes: z.string().min(1),
  clientSecret: z.string().optional(),
  promptLogin: z.boolean().optional(),
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
const updateClientScopesSchema = z.object({
  clientId: z.string().min(1),
  scopes: z.array(z.string().min(1)),
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
const updateClientReauthSchema = z.object({
  clientId: z.string().min(1),
  reauthTtlSeconds: z.number().int().min(0).max(86400),
});

const idTokenAlgOptions = ["default", ...SUPPORTED_JWT_SIGNING_ALGS] as const;
const accessTokenAlgOptions = ["match_id", ...SUPPORTED_JWT_SIGNING_ALGS] as const;
const updateClientSigningAlgsSchema = z.object({
  clientId: z.string().min(1),
  idTokenAlg: z.enum(idTokenAlgOptions),
  accessTokenAlg: z.enum(accessTokenAlgOptions),
});

const updateClientTokenConfigSchema = z.object({
  clientId: z.string().min(1),
  tokenEndpointAuthMethods: z.array(z.enum(TOKEN_AUTH_METHODS)).min(1),
  pkceRequired: z.boolean(),
  allowedGrantTypes: z.array(z.enum(grantTypeOptions)).min(1),
});

const deleteClientSchema = z.object({ clientId: z.string().min(1) });

const updateProxyConfigSchema = proxyProviderConfigSchema.extend({ clientId: z.string().min(1) });

const requireSession = async () => {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }
  return session.user.id;
};

const emitConfigChange = async (input: {
  tenantId: string;
  actorId: string;
  action: string;
  resource: string;
  resourceId?: string | null;
  resourceName?: string | null;
  clientId?: string | null;
  message: string;
  proxyConfigBefore?: ProxyProviderConfigSnapshot | null;
  proxyConfigAfter?: ProxyProviderConfigSnapshot | null;
  authMethodBefore?: TokenAuthMethod | null;
  authMethodAfter?: TokenAuthMethod | null;
  authMethodsBefore?: TokenAuthMethod[] | null;
  authMethodsAfter?: TokenAuthMethod[] | null;
}) => {
  const requestContext = await getRequestContext();
  await emitAuditEvent({
    tenantId: input.tenantId,
    clientId: input.clientId ?? null,
    traceId: null,
    actorId: input.actorId,
    eventType: "CONFIG_CHANGED",
    severity: "INFO",
    message: input.message,
    details: buildConfigChangedDetails({
      action: input.action,
      resource: input.resource,
      resourceId: input.resourceId,
      resourceName: input.resourceName,
      proxyConfigBefore: input.proxyConfigBefore ?? undefined,
      proxyConfigAfter: input.proxyConfigAfter ?? undefined,
      authMethodBefore: input.authMethodBefore ?? undefined,
      authMethodAfter: input.authMethodAfter ?? undefined,
      authMethodsBefore: input.authMethodsBefore ?? undefined,
      authMethodsAfter: input.authMethodsAfter ?? undefined,
    }),
    requestContext,
  });
};

const clientPath = (clientId: string) => `/admin/clients/${clientId}`;

const getClientForAdmin = async (clientId: string, adminId: string, allowedRoles?: MembershipRole[]) => {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: {
      id: true,
      tenantId: true,
      name: true,
      oauthClientMode: true,
      tokenEndpointAuthMethods: true,
      pkceRequired: true,
      allowedGrantTypes: true,
    },
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
    void emitConfigChange({
      tenantId: tenant.id,
      actorId: adminId,
      action: "create",
      resource: "tenant",
      resourceId: tenant.id,
      resourceName: tenant.name,
      message: "Tenant created",
    });
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
): Promise<ActionState<{ clientId: string; clientSecret?: string; providerRedirectUri?: string }>> => {
  try {
    const adminId = await requireSession();
    const parsed = clientSchema.parse(input);
    const membership = await assertTenantMembership(adminId, parsed.tenantId);
    ensureMembershipRole(membership.role, ["OWNER", "WRITER"]);
    if (parsed.mode === "proxy") {
      const proxyValidationError = validateProxyConfigInput(parsed.proxyConfig);
      if (proxyValidationError) {
        return { error: proxyValidationError };
      }
    }
    const redirectEntries = parsed.redirects?.filter(Boolean);
    const normalizedScopes = parsed.scopes ? normalizeScopes(parsed.scopes) : Array.from(SUPPORTED_SCOPES);
    if (!normalizedScopes.includes("openid")) {
      return { error: "Scopes must include openid" };
    }
    const invalid = normalizedScopes.filter((scope) => !isValidScopeValue(scope));
    if (invalid.length > 0) {
      return { error: `Scopes must match ^[a-z0-9:_-]{1,64}$: ${invalid.join(", ")}` };
    }
    const canonicalScopes = ["openid", ...normalizedScopes.filter((scope) => scope !== "openid")];
    const proxyConfigResult = parsed.mode === "proxy"
      ? normalizeProxyConfigInput(parsed.proxyConfig)
      : { normalized: undefined, keepExistingSecret: false };

    const { client, clientSecret } = await createClient(parsed.tenantId, {
      name: parsed.name,
      tokenEndpointAuthMethods: parsed.tokenEndpointAuthMethods,
      pkceRequired: parsed.pkceRequired,
      allowedGrantTypes: parsed.allowedGrantTypes,
      redirectUris: redirectEntries,
      allowedScopes: canonicalScopes,
      oauthClientMode: parsed.mode,
      proxyConfig: proxyConfigResult.normalized,
    });
    let providerRedirectUri: string | undefined;
    if (parsed.mode === "proxy") {
      const origin = await getRequestOrigin();
      const tenant = await prisma.tenant.findUnique({
        where: { id: parsed.tenantId },
        select: { defaultApiResourceId: true },
      });
      const resourceId = client.apiResourceId ?? tenant?.defaultApiResourceId;
      if (resourceId) {
        providerRedirectUri = new URL(`/r/${resourceId}/oidc/proxy/callback`, origin).toString();
      }
    }
    revalidatePath("/admin", "layout");
    revalidatePath("/admin/clients");
    revalidatePath(clientPath(client.id));
    void emitConfigChange({
      tenantId: parsed.tenantId,
      actorId: adminId,
      action: "create",
      resource: "client",
      resourceId: client.id,
      resourceName: client.name,
      clientId: client.id,
      message: "Client created",
    });
    return {
      success: "Client created",
      data: { clientId: client.clientId, clientSecret: clientSecret ?? undefined, providerRedirectUri },
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
    const resource = await createApiResource(parsed.tenantId, { name: parsed.name, description: parsed.description });
    revalidatePath("/admin/api-resources");
    revalidatePath("/admin/clients");
    void emitConfigChange({
      tenantId: parsed.tenantId,
      actorId: adminId,
      action: "create",
      resource: "api_resource",
      resourceId: resource.id,
      resourceName: resource.name,
      message: "API resource created",
    });
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
    const resource = await updateApiResourceRecord(parsed.tenantId, parsed.apiResourceId, {
      name: parsed.name,
      description: parsed.description,
    });
    revalidatePath("/admin/api-resources");
    revalidatePath("/admin/clients");
    void emitConfigChange({
      tenantId: parsed.tenantId,
      actorId: adminId,
      action: "update",
      resource: "api_resource",
      resourceId: resource.id,
      resourceName: resource.name,
      message: "API resource updated",
    });
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
    void emitConfigChange({
      tenantId: parsed.tenantId,
      actorId: adminId,
      action: "update",
      resource: "tenant_default_resource",
      resourceId: parsed.apiResourceId,
      message: "Default API resource updated",
    });
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
    await rotateKeyForAlg(parsed.tenantId, parsed.alg);
    revalidatePath("/admin", "layout");
    void emitConfigChange({
      tenantId: parsed.tenantId,
      actorId: adminId,
      action: "rotate",
      resource: "tenant_key",
      resourceName: parsed.alg,
      message: `Signing key rotated (${parsed.alg})`,
    });
    return { success: `Signing key rotated (${parsed.alg})` };
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
    const tokenAuthMethods = parseTokenAuthMethods(client.tokenEndpointAuthMethods);
    if (!requiresClientSecret(tokenAuthMethods)) {
      return { error: "Client does not require a secret" };
    }
    const clientSecret = await rotateClientSecret(client.id);
    revalidatePath(clientPath(client.id));
    void emitConfigChange({
      tenantId: client.tenantId,
      actorId: adminId,
      action: "rotate",
      resource: "client_secret",
      resourceId: client.id,
      clientId: client.id,
      message: "Client secret rotated",
    });
    return { success: "Client secret rotated", data: { clientSecret } };
  } catch (error) {
    console.error(error);
    return { error: "Unable to rotate secret" };
  }
};

export const updateClientTokenConfigAction = async (
  input: z.infer<typeof updateClientTokenConfigSchema>,
): Promise<ActionState<{ clientSecret?: string }>> => {
  try {
    const adminId = await requireSession();
    const parsed = updateClientTokenConfigSchema.parse(input);
    const client = await getClientForAdmin(parsed.clientId, adminId, ["OWNER", "WRITER"]);
    if (!client) {
      return { error: "Client not found" };
    }

    const { client: updated, clientSecret } = await updateClientTokenConfig({
      clientId: client.id,
      tokenEndpointAuthMethods: parsed.tokenEndpointAuthMethods,
      pkceRequired: parsed.pkceRequired,
      allowedGrantTypes: parsed.allowedGrantTypes,
    });
    const authMethodsBefore = parseTokenAuthMethods(client.tokenEndpointAuthMethods);
    const authMethodsAfter = parseTokenAuthMethods(updated.tokenEndpointAuthMethods);
    revalidatePath(clientPath(client.id));
    revalidatePath("/admin/clients");
    void emitConfigChange({
      tenantId: updated.tenantId,
      actorId: adminId,
      action: "update",
      resource: "client_token_config",
      resourceId: updated.id,
      resourceName: client.name,
      clientId: updated.id,
      message: "Client token settings updated",
      authMethodsBefore,
      authMethodsAfter,
    });
    return clientSecret
      ? { success: "Client token settings updated", data: { clientSecret } }
      : { success: "Client token settings updated" };
  } catch (error) {
    if (error instanceof DomainError) {
      return { error: error.message };
    }
    console.error(error);
    return { error: "Unable to update client token settings" };
  }
};

export const updateProxyClientConfigAction = async (
  input: z.infer<typeof updateProxyConfigSchema>,
): Promise<ActionState> => {
  try {
    const adminId = await requireSession();
    const parsed = updateProxyConfigSchema.parse(input);
    const client = await getClientForAdmin(parsed.clientId, adminId, ["OWNER", "WRITER"]);
    if (!client) {
      return { error: "Client not found" };
    }
    if (client.oauthClientMode !== "proxy") {
      return { error: "Client is not configured for proxy mode" };
    }
    const { clientId, ...rawConfig } = parsed;
    const validationError = validateProxyConfigInput(rawConfig);
    if (validationError) {
      return { error: validationError };
    }

    const { normalized, keepExistingSecret } = normalizeProxyConfigInput(rawConfig, {
      treatUndefinedSecretAsNoChange: true,
    });

    if (!normalized) {
      return { error: "Proxy configuration is required" };
    }

    const existingConfig = await prisma.proxyProviderConfig.findUnique({ where: { clientId: client.id } });
    const existingAuthMethod = existingConfig?.upstreamTokenEndpointAuthMethod ?? undefined;
    const normalizedExistingAuthMethod = isTokenAuthMethod(existingAuthMethod) ? existingAuthMethod : undefined;
    const resolvedAuthMethod =
      rawConfig.upstreamTokenEndpointAuthMethod ??
      normalizedExistingAuthMethod ??
      normalized.upstreamTokenEndpointAuthMethod;
    const normalizedConfig = {
      ...normalized,
      upstreamTokenEndpointAuthMethod: resolvedAuthMethod,
    };
    const existingSecret = existingConfig
      ? decryptProxySecret(existingConfig.upstreamClientSecretEncrypted)
      : undefined;
    const proxyConfigBefore = existingConfig
      ? buildProxyConfigSnapshot({
          providerType: existingConfig.providerType,
          authorizationEndpoint: existingConfig.authorizationEndpoint,
          tokenEndpoint: existingConfig.tokenEndpoint,
          userinfoEndpoint: existingConfig.userinfoEndpoint ?? undefined,
          jwksUri: existingConfig.jwksUri ?? undefined,
          upstreamClientId: existingConfig.upstreamClientId,
          upstreamClientSecret: existingSecret ?? undefined,
          upstreamTokenEndpointAuthMethod: normalizedExistingAuthMethod ?? undefined,
          defaultScopes: existingConfig.defaultScopes ?? [],
          scopeMapping: existingConfig.scopeMapping
            ? (existingConfig.scopeMapping as ProxyProviderConfigInput["scopeMapping"])
            : undefined,
          pkceSupported: existingConfig.pkceSupported,
          oidcEnabled: existingConfig.oidcEnabled,
          promptPassthroughEnabled: existingConfig.promptPassthroughEnabled,
          loginHintPassthroughEnabled: existingConfig.loginHintPassthroughEnabled,
          passthroughTokenResponse: existingConfig.passthroughTokenResponse,
        })
      : undefined;
    const resolvedSecret = keepExistingSecret ? existingSecret : normalizedConfig.upstreamClientSecret;
    const proxyConfigAfter = buildProxyConfigSnapshot({
      ...normalizedConfig,
      upstreamClientSecret: resolvedSecret ?? undefined,
    });

    await upsertProxyProviderConfig(client.id, normalizedConfig, { keepExistingSecret });
    revalidatePath(clientPath(client.id));
    void emitConfigChange({
      tenantId: client.tenantId,
      actorId: adminId,
      action: "update",
      resource: "proxy_config",
      resourceId: client.id,
      clientId: client.id,
      message: "Proxy configuration updated",
      proxyConfigBefore,
      proxyConfigAfter,
      authMethodBefore: proxyConfigBefore?.upstreamTokenEndpointAuthMethod ?? undefined,
      authMethodAfter: proxyConfigAfter.upstreamTokenEndpointAuthMethod ?? undefined,
    });
    return { success: "Upstream configuration updated" };
  } catch (error) {
    console.error(error);
    return { error: "Failed to update proxy configuration" };
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
    const redirect = await addRedirectUri(client.id, parsed.uri);
    revalidatePath(clientPath(client.id));
    revalidatePath(`${clientPath(client.id)}/test`);
    void emitConfigChange({
      tenantId: client.tenantId,
      actorId: adminId,
      action: "create",
      resource: "redirect_uri",
      resourceId: redirect.id,
      resourceName: redirect.uri,
      clientId: client.id,
      message: "Redirect URI added",
    });
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

    const tokenAuthMethods = parseTokenAuthMethods(client.tokenEndpointAuthMethods);

    const clearedStates = await resetOauthTestSessionsForClient(client.id, adminId);
    if (clearedStates.length && requiresClientSecret(tokenAuthMethods)) {
      await Promise.all(clearedStates.map((stateId) => clearOauthTestSecretCookie(client.id, stateId)));
    }

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

    const tokenAuthMethod = tokenAuthMethods[0];
    const requiresSecret = requiresClientSecret(tokenAuthMethods);
    const submittedSecretProvided = typeof parsed.clientSecret === "string";
    const submittedSecret = requiresSecret && submittedSecretProvided ? parsed.clientSecret?.trim() || null : null;
    const storedSecret = requiresSecret ? await getClientSecret(client.id) : null;
    const cookieSecret = requiresSecret ? submittedSecret ?? storedSecret : null;
    if (requiresSecret && submittedSecretProvided && !submittedSecret) {
      return { error: "Enter the client secret before starting the test." };
    }
    if (requiresSecret && !cookieSecret) {
      return { error: "Client secret unavailable. Rotate the secret and try again." };
    }

    const codeVerifier = randomBytes(32).toString("base64url");
    const codeChallenge = computeS256Challenge(codeVerifier);
    const state = randomUUID();
    const nonce = randomBytes(16).toString("base64url");
    const expiresAt = addMinutes(new Date(), OAUTH_TEST_SESSION_TTL_MINUTES);

    await createOauthTestSession({
      id: state,
      clientId: client.id,
      adminUserId: adminId,
      tenantId: client.tenantId,
      redirectUri,
      scopes: normalizedScopes,
      codeVerifier,
      nonce,
      expiresAt,
    });

    if (cookieSecret) {
      await setOauthTestSecretCookie(client.id, state, cookieSecret);
    }

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
    if (parsed.promptLogin) {
      authorizeUrl.searchParams.set("prompt", "login");
    }

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
    const updated = await updateClientName(client.id, parsed.name);
    revalidatePath(clientPath(client.id));
    revalidatePath("/admin/clients");
    void emitConfigChange({
      tenantId: updated.tenantId,
      actorId: adminId,
      action: "update",
      resource: "client",
      resourceId: updated.id,
      resourceName: updated.name,
      clientId: updated.id,
      message: "Client updated",
    });
    return { success: "Client updated" };
  } catch (error) {
    console.error(error);
    return { error: "Unable to update client" };
  }
};

export const updateClientReauthTtlAction = async (input: z.infer<typeof updateClientReauthSchema>): Promise<ActionState> => {
  try {
    const adminId = await requireSession();
    const parsed = updateClientReauthSchema.parse(input);
    const client = await getClientForAdmin(parsed.clientId, adminId, ["OWNER", "WRITER"]);
    if (!client) {
      return { error: "Client not found" };
    }
    const updated = await updateClientReauthTtl(client.id, parsed.reauthTtlSeconds);
    revalidatePath(clientPath(client.id));
    void emitConfigChange({
      tenantId: updated.tenantId,
      actorId: adminId,
      action: "update",
      resource: "client_reauth_ttl",
      resourceId: updated.id,
      clientId: updated.id,
      message: "Client reauth TTL updated",
    });
    return { success: parsed.reauthTtlSeconds > 0 ? "Re-auth TTL updated" : "Re-auth disabled" };
  } catch (error) {
    console.error(error);
    return { error: "Unable to update re-auth TTL" };
  }
};

export const updateClientSigningAlgsAction = async (
  input: z.infer<typeof updateClientSigningAlgsSchema>,
): Promise<ActionState> => {
  try {
    const adminId = await requireSession();
    const parsed = updateClientSigningAlgsSchema.parse(input);
    const client = await getClientForAdmin(parsed.clientId, adminId, ["OWNER", "WRITER"]);
    if (!client) {
      return { error: "Client not found" };
    }

    const idTokenAlg = parsed.idTokenAlg === "default" ? null : parsed.idTokenAlg;
    const accessTokenAlg = parsed.accessTokenAlg === "match_id" ? null : parsed.accessTokenAlg;

    const updated = await updateClientSigningAlgorithms(client.id, {
      idTokenAlg,
      accessTokenAlg,
    });

    revalidatePath(clientPath(client.id));
    revalidatePath("/admin/clients");
    revalidatePath("/admin", "layout");
    void emitConfigChange({
      tenantId: updated.tenantId,
      actorId: adminId,
      action: "update",
      resource: "client_signing",
      resourceId: updated.id,
      clientId: updated.id,
      message: "Client signing algorithms updated",
    });
    return { success: "Signing algorithms updated" };
  } catch (error) {
    console.error(error);
    return { error: "Unable to update signing algorithms" };
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

    const updated = await updateClientApiResource(client.id, apiResourceId);
    revalidatePath(clientPath(client.id));
    revalidatePath("/admin/clients");
    void emitConfigChange({
      tenantId: updated.tenantId,
      actorId: adminId,
      action: "update",
      resource: "client_issuer",
      resourceId: updated.id,
      clientId: updated.id,
      message: "Client issuer updated",
    });
    return { success: "Client issuer updated" };
  } catch (error) {
    console.error(error);
    return { error: "Unable to update issuer" };
  }
};

export const updateClientScopesAction = async (
  input: z.infer<typeof updateClientScopesSchema>,
): Promise<ActionState<{ allowedScopes: string[] }>> => {
  try {
    const adminId = await requireSession();
    const parsed = updateClientScopesSchema.parse(input);
    const client = await getClientForAdmin(parsed.clientId, adminId, ["OWNER", "WRITER"]);
    if (!client) {
      return { error: "Client not found" };
    }

    const normalized = normalizeScopes(parsed.scopes);
    if (!normalized.includes("openid")) {
      return { error: "Scopes must include openid" };
    }
    const invalid = normalized.filter((scope) => !isValidScopeValue(scope));
    if (invalid.length > 0) {
      return { error: `Scopes must match ^[a-z0-9:_-]{1,64}$: ${invalid.join(", ")}` };
    }
    const canonical = ["openid", ...normalized.filter((scope) => scope !== "openid")];
    const updated = await updateClientAllowedScopes(client.id, canonical);
    revalidatePath(clientPath(client.id));
    void emitConfigChange({
      tenantId: updated.tenantId,
      actorId: adminId,
      action: "update",
      resource: "client_scopes",
      resourceId: updated.id,
      clientId: updated.id,
      message: "Client scopes updated",
    });
    return { success: "Scopes updated", data: { allowedScopes: canonical } };
  } catch (error) {
    console.error(error);
    return { error: "Unable to update scopes" };
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
    const updated = await updateClientAuthStrategies(client.id, strategies);
    revalidatePath(clientPath(client.id));
    revalidatePath("/admin/clients");
    void emitConfigChange({
      tenantId: updated.tenantId,
      actorId: adminId,
      action: "update",
      resource: "client_auth_strategies",
      resourceId: updated.id,
      clientId: updated.id,
      message: "Client auth strategies updated",
    });
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
      select: { id: true, uri: true, clientId: true, client: { select: { tenantId: true } } },
    });
    if (!redirect) {
      return { error: "Redirect not found" };
    }
    const membership = await assertTenantMembership(adminId, redirect.client.tenantId);
    ensureMembershipRole(membership.role, ["OWNER", "WRITER"]);
    await prisma.redirectUri.delete({ where: { id: redirect.id } });
    revalidatePath(clientPath(redirect.clientId));
    void emitConfigChange({
      tenantId: redirect.client.tenantId,
      actorId: adminId,
      action: "delete",
      resource: "redirect_uri",
      resourceId: redirect.id,
      resourceName: redirect.uri,
      clientId: redirect.clientId,
      message: "Redirect URI removed",
    });
    return { success: "Redirect removed" };
  } catch (error) {
    console.error(error);
    return { error: "Unable to remove redirect" };
  }
};

export const deleteClientAction = async (input: z.infer<typeof deleteClientSchema>): Promise<ActionState> => {
  try {
    const adminId = await requireSession();
    const parsed = deleteClientSchema.parse(input);
    const client = await getClientForAdmin(parsed.clientId, adminId, ["OWNER", "WRITER"]);
    if (!client) {
      return { error: "Client not found" };
    }
    await emitConfigChange({
      tenantId: client.tenantId,
      actorId: adminId,
      action: "delete",
      resource: "client",
      resourceId: client.id,
      resourceName: client.name,
      clientId: client.id,
      message: "Client deleted",
    });
    await deleteClient(client.id);
    revalidatePath("/admin", "layout");
    revalidatePath("/admin/clients");
    return { success: "Client deleted" };
  } catch (error) {
    if (error instanceof DomainError) {
      return { error: error.message };
    }
    console.error(error);
    return { error: "Unable to delete client" };
  }
};

export const updateMemberRoleAction = async (input: z.infer<typeof updateMemberRoleSchema>): Promise<ActionState> => {
  try {
    const adminId = await requireSession();
    const parsed = updateMemberRoleSchema.parse(input);
    await assertTenantRole(adminId, parsed.tenantId, ["OWNER"]);
    const membership = await updateMemberRole(parsed.tenantId, parsed.membershipId, parsed.role);
    revalidatePath("/admin/members");
    void emitConfigChange({
      tenantId: parsed.tenantId,
      actorId: adminId,
      action: "update",
      resource: "membership",
      resourceId: membership.id,
      message: "Member role updated",
    });
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
    void emitConfigChange({
      tenantId: parsed.tenantId,
      actorId: adminId,
      action: "delete",
      resource: "membership",
      resourceId: parsed.membershipId,
      message: "Member removed",
    });
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
    void emitConfigChange({
      tenantId: invite.tenantId,
      actorId: adminId,
      action: "create",
      resource: "invite",
      resourceId: invite.id,
      message: "Invite created",
    });
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
    const invite = await revokeInvite(parsed.tenantId, parsed.inviteId);
    revalidatePath("/admin/members");
    void emitConfigChange({
      tenantId: invite.tenantId,
      actorId: adminId,
      action: "revoke",
      resource: "invite",
      resourceId: invite.id,
      message: "Invite revoked",
    });
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
    await emitConfigChange({
      tenantId: parsed.tenantId,
      actorId: adminId,
      action: "delete",
      resource: "tenant",
      resourceId: parsed.tenantId,
      message: "Tenant deleted",
    });
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
