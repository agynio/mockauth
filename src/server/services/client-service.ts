import { nanoid } from "nanoid";

import type { Prisma, JwtSigningAlg } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";
import { hashSecret } from "@/server/crypto/hash";
import { encrypt, decrypt } from "@/server/crypto/key-vault";
import { generateOpaqueToken } from "@/server/crypto/opaque-token";
import { DomainError } from "@/server/errors";
import { classifyRedirect } from "@/server/oidc/redirect-uri";
import type { ClientAuthStrategies } from "@/server/oidc/auth-strategy";
import { DEFAULT_CLIENT_AUTH_STRATEGIES } from "@/server/oidc/auth-strategy";
import { isValidScopeValue, normalizeScopes, SUPPORTED_SCOPES } from "@/server/oidc/scopes";
import {
  TOKEN_AUTH_METHODS,
  parseTokenAuthMethods,
  requiresClientSecret,
  type TokenAuthMethod,
} from "@/server/oidc/token-auth-method";
import { z } from "zod";

const canonicalizeAllowedScopes = (scopes?: string[]) => {
  const normalized = scopes && scopes.length > 0 ? normalizeScopes(scopes) : Array.from(SUPPORTED_SCOPES);
  if (!normalized.includes("openid")) {
    throw new Error("Allowed scopes must include openid");
  }
  const invalid = normalized.filter((scope) => !isValidScopeValue(scope));
  if (invalid.length > 0) {
    throw new Error(`Invalid scope format: ${invalid.join(", ")}`);
  }
  return ["openid", ...normalized.filter((scope) => scope !== "openid")];
};

const normalizeAllowedGrantTypes = (grantTypes: string[]) => {
  if (grantTypes.length === 0) {
    throw new Error("At least one grant type is required");
  }
  return Array.from(new Set(grantTypes));
};

export const proxyProviderConfigSchema = z.object({
  providerType: z.enum(["oidc", "oauth2"] as const),
  authorizationEndpoint: z.string().url(),
  tokenEndpoint: z.string().url(),
  userinfoEndpoint: z.string().url().optional(),
  jwksUri: z.string().url().optional(),
  upstreamClientId: z.string().trim().min(1),
  upstreamClientSecret: z
    .string()
    .transform((value) => {
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : undefined;
    })
    .optional(),
  upstreamTokenEndpointAuthMethod: z.enum(TOKEN_AUTH_METHODS).optional(),
  defaultScopes: z.array(z.string().min(1)).optional(),
  scopeMapping: z
    .record(z.string(), z.union([z.string(), z.array(z.string().min(1))]))
    .optional(),
  pkceSupported: z.boolean().optional(),
  oidcEnabled: z.boolean().optional(),
  promptPassthroughEnabled: z.boolean().optional(),
  loginHintPassthroughEnabled: z.boolean().optional(),
  passthroughTokenResponse: z.boolean().optional(),
});

export type ProxyProviderConfigInput = z.infer<typeof proxyProviderConfigSchema>;

const normalizeProviderScopes = (scopes?: string[]) => {
  if (!scopes) {
    return [] as string[];
  }
  const set = new Set<string>();
  for (const scope of scopes) {
    const trimmed = scope.trim();
    if (trimmed.length > 0) {
      set.add(trimmed);
    }
  }
  return Array.from(set);
};

const normalizeScopeMapping = (mapping?: ProxyProviderConfigInput["scopeMapping"]) => {
  if (!mapping) {
    return undefined;
  }
  const normalized: Record<string, string[]> = {};
  for (const [key, raw] of Object.entries(mapping)) {
    const trimmedKey = key.trim();
    if (!trimmedKey) {
      continue;
    }
    const values = Array.isArray(raw)
      ? raw
      : typeof raw === "string"
        ? raw.split(/\s+/)
        : [];
    const normalizedValues = normalizeProviderScopes(values as string[]);
    if (normalizedValues.length > 0) {
      normalized[trimmedKey] = normalizedValues;
    }
  }
  return Object.keys(normalized).length > 0 ? normalized : undefined;
};

export const getClientForTenant = async (tenantId: string, clientId: string) => {
  const client = await prisma.client.findFirst({
    where: { tenantId, clientId },
    include: { redirectUris: true, proxyConfig: true },
  });

  if (!client) {
    throw new DomainError("Unknown client", { status: 400, code: "invalid_client" });
  }

  return client;
};

export const createClient = async (
  tenantId: string,
  data: {
    name: string;
    tokenEndpointAuthMethods: TokenAuthMethod[];
    pkceRequired?: boolean;
    allowedGrantTypes?: string[];
    redirectUris?: string[];
    allowedScopes?: string[];
    oauthClientMode?: "regular" | "proxy" | "preauthorized";
    proxyConfig?: ProxyProviderConfigInput;
  },
) => {
  const clientId = `client_${nanoid(16)}`;
  let clientSecret: string | null = null;
  let clientSecretHash: string | null = null;
  let clientSecretEncrypted: string | null = null;
  const allowedScopes = canonicalizeAllowedScopes(data.allowedScopes);
  const tokenEndpointAuthMethods = parseTokenAuthMethods(data.tokenEndpointAuthMethods);
  const allowedGrantTypes = data.allowedGrantTypes ? normalizeAllowedGrantTypes(data.allowedGrantTypes) : undefined;
  const mode = data.oauthClientMode ?? "regular";

  if ((mode === "proxy" || mode === "preauthorized") && !data.proxyConfig) {
    throw new DomainError("Upstream clients require provider configuration", { status: 400 });
  }

  const validatedProxyConfig = data.proxyConfig ? proxyProviderConfigSchema.parse(data.proxyConfig) : null;

  if (requiresClientSecret(tokenEndpointAuthMethods)) {
    clientSecret = generateOpaqueToken(24);
    clientSecretHash = await hashSecret(clientSecret);
    clientSecretEncrypted = encrypt(clientSecret);
  }

  const client = await prisma.$transaction(async (tx) => {
    const created = await tx.client.create({
      data: {
        name: data.name,
        tenantId,
        clientId,
        clientSecretHash,
        clientSecretEncrypted,
        tokenEndpointAuthMethods,
        pkceRequired: data.pkceRequired ?? true,
        authStrategies: DEFAULT_CLIENT_AUTH_STRATEGIES,
        allowedScopes,
        ...(allowedGrantTypes ? { allowedGrantTypes } : {}),
        oauthClientMode: mode,
      },
    });

    if (data.redirectUris?.length) {
      for (const raw of data.redirectUris) {
        const { normalized, type } = classifyRedirect(raw);
        await tx.redirectUri.create({ data: { clientId: created.id, uri: normalized, type } });
      }
    }

    if ((mode === "proxy" || mode === "preauthorized") && validatedProxyConfig) {
      const trimmedUpstreamClientId = validatedProxyConfig.upstreamClientId.trim();
      const normalizedSecret = validatedProxyConfig.upstreamClientSecret?.trim();
      await tx.proxyProviderConfig.create({
        data: {
          clientId: created.id,
          providerType: validatedProxyConfig.providerType,
          authorizationEndpoint: validatedProxyConfig.authorizationEndpoint,
          tokenEndpoint: validatedProxyConfig.tokenEndpoint,
          userinfoEndpoint: validatedProxyConfig.userinfoEndpoint ?? null,
          jwksUri: validatedProxyConfig.jwksUri ?? null,
          upstreamClientId: trimmedUpstreamClientId,
          upstreamClientSecretEncrypted: normalizedSecret
            ? encrypt(normalizedSecret)
            : null,
          upstreamTokenEndpointAuthMethod: validatedProxyConfig.upstreamTokenEndpointAuthMethod ?? "client_secret_basic",
          defaultScopes: normalizeProviderScopes(validatedProxyConfig.defaultScopes),
          scopeMapping: normalizeScopeMapping(validatedProxyConfig.scopeMapping),
          pkceSupported: Boolean(validatedProxyConfig.pkceSupported),
          oidcEnabled: Boolean(validatedProxyConfig.oidcEnabled),
          promptPassthroughEnabled: Boolean(validatedProxyConfig.promptPassthroughEnabled),
          loginHintPassthroughEnabled: Boolean(validatedProxyConfig.loginHintPassthroughEnabled),
          passthroughTokenResponse: Boolean(validatedProxyConfig.passthroughTokenResponse),
        },
      });
    }

    return created;
  });

  return { client, clientSecret };
};

export const addRedirectUri = async (clientId: string, value: string) => {
  const client = await prisma.client.findUnique({ where: { id: clientId } });
  if (!client) {
    throw new DomainError("Client not found", { status: 404 });
  }

  const { normalized, type } = classifyRedirect(value);
  return prisma.redirectUri.create({
    data: {
      clientId,
      uri: normalized,
      type,
    },
  });
};

const DEFAULT_PAGE_SIZE = 10;

export const listClients = async (
  tenantId: string,
  options?: { search?: string; page?: number; pageSize?: number },
) => {
  const pageSize = Math.max(1, options?.pageSize ?? DEFAULT_PAGE_SIZE);
  const page = Math.max(1, options?.page ?? 1);
  const searchValue = options?.search?.trim();
  const searchFilter: Prisma.StringFilter<"Client"> | null = searchValue
    ? { contains: searchValue, mode: "insensitive" as Prisma.QueryMode }
    : null;
  const where: Prisma.ClientWhereInput = {
    tenantId,
    ...(searchFilter
      ? {
          OR: [{ name: searchFilter }, { clientId: searchFilter }],
        }
      : {}),
  };

  const [clients, total] = await prisma.$transaction([
    prisma.client.findMany({
      where,
      include: { _count: { select: { redirectUris: true } } },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.client.count({ where }),
  ]);

  return { clients, total, page, pageSize };
};

export const listClientSummaries = async (tenantId: string) => {
  return prisma.client.findMany({
    where: { tenantId },
    select: { id: true, name: true, clientId: true },
    orderBy: { name: "asc" },
  });
};

export const getClientByIdForTenant = async (tenantId: string, clientInternalId: string) => {
  const client = await prisma.client.findFirst({
    where: { id: clientInternalId, tenantId },
    include: {
      redirectUris: { orderBy: { createdAt: "asc" } },
      tenant: { include: { defaultApiResource: true } },
      apiResource: true,
      proxyConfig: true,
    },
  });

  if (!client) {
    throw new DomainError("Client not found", { status: 404 });
  }

  return client;
};

export const rotateClientSecret = async (clientId: string) => {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { tokenEndpointAuthMethods: true },
  });
  if (!client) {
    throw new DomainError("Client not found", { status: 404 });
  }
  const tokenEndpointAuthMethods = parseTokenAuthMethods(client.tokenEndpointAuthMethods);
  if (!requiresClientSecret(tokenEndpointAuthMethods)) {
    throw new DomainError("Client does not require a secret", { status: 400 });
  }
  const secret = generateOpaqueToken(24);
  const clientSecretHash = await hashSecret(secret);
  const clientSecretEncrypted = encrypt(secret);

  await prisma.client.update({
    where: { id: clientId },
    data: { clientSecretHash, clientSecretEncrypted },
  });

  return secret;
};

export const updateClientTokenConfig = async (input: {
  clientId: string;
  tokenEndpointAuthMethods: string[];
  pkceRequired: boolean;
  allowedGrantTypes: string[];
}): Promise<{ client: Awaited<ReturnType<typeof prisma.client.update>>; clientSecret: string | null }> => {
  const tokenEndpointAuthMethods = parseTokenAuthMethods(input.tokenEndpointAuthMethods);
  const allowedGrantTypes = normalizeAllowedGrantTypes(input.allowedGrantTypes);
  const needsSecret = requiresClientSecret(tokenEndpointAuthMethods);

  return prisma.$transaction(async (tx) => {
    const client = await tx.client.findUnique({
      where: { id: input.clientId },
      select: { id: true, clientSecretHash: true, clientSecretEncrypted: true },
    });
    if (!client) {
      throw new DomainError("Client not found", { status: 404 });
    }

    let clientSecret: string | null = null;
    let clientSecretHash = client.clientSecretHash;
    let clientSecretEncrypted = client.clientSecretEncrypted;

    if (needsSecret) {
      if (!clientSecretHash || !clientSecretEncrypted) {
        clientSecret = generateOpaqueToken(24);
        clientSecretHash = await hashSecret(clientSecret);
        clientSecretEncrypted = encrypt(clientSecret);
      }
    } else {
      clientSecretHash = null;
      clientSecretEncrypted = null;
    }

    const updated = await tx.client.update({
      where: { id: input.clientId },
      data: {
        tokenEndpointAuthMethods,
        pkceRequired: input.pkceRequired,
        allowedGrantTypes,
        clientSecretHash,
        clientSecretEncrypted,
      },
    });

    return { client: updated, clientSecret };
  });
};

export const deleteClient = async (clientId: string) => {
  const client = await prisma.client.findUnique({ where: { id: clientId } });
  if (!client) {
    throw new DomainError("Client not found", { status: 404 });
  }
  return prisma.client.delete({ where: { id: clientId } });
};

export const upsertProxyProviderConfig = async (
  clientId: string,
  config: ProxyProviderConfigInput,
  options?: { keepExistingSecret?: boolean },
) => {
  const parsed = proxyProviderConfigSchema.parse(config);
  const normalizedScopes = normalizeProviderScopes(parsed.defaultScopes);
  const normalizedMapping = normalizeScopeMapping(parsed.scopeMapping);
  const trimmedUpstreamClientId = parsed.upstreamClientId.trim();
  const normalizedSecret = parsed.upstreamClientSecret?.trim();
  const encryptedSecret = normalizedSecret ? encrypt(normalizedSecret) : null;
  const shouldUpdateSecret = !options?.keepExistingSecret && parsed.upstreamClientSecret !== undefined;

  const baseUpdate = {
    providerType: parsed.providerType,
    authorizationEndpoint: parsed.authorizationEndpoint,
    tokenEndpoint: parsed.tokenEndpoint,
    userinfoEndpoint: parsed.userinfoEndpoint ?? null,
    jwksUri: parsed.jwksUri ?? null,
    upstreamClientId: trimmedUpstreamClientId,
    upstreamTokenEndpointAuthMethod: parsed.upstreamTokenEndpointAuthMethod ?? "client_secret_basic",
    defaultScopes: normalizedScopes,
    scopeMapping: normalizedMapping,
    pkceSupported: Boolean(parsed.pkceSupported),
    oidcEnabled: Boolean(parsed.oidcEnabled),
    promptPassthroughEnabled: Boolean(parsed.promptPassthroughEnabled),
    loginHintPassthroughEnabled: Boolean(parsed.loginHintPassthroughEnabled),
    passthroughTokenResponse: Boolean(parsed.passthroughTokenResponse),
  } satisfies Prisma.ProxyProviderConfigUpdateInput;

  await prisma.proxyProviderConfig.upsert({
    where: { clientId },
    update: {
      ...baseUpdate,
      ...(shouldUpdateSecret ? { upstreamClientSecretEncrypted: encryptedSecret } : {}),
    },
    create: {
      clientId,
      ...baseUpdate,
      upstreamClientSecretEncrypted: encryptedSecret,
    },
  });
};

export const updateClientName = async (clientId: string, name: string) => {
  return prisma.client.update({ where: { id: clientId }, data: { name } });
};

export const updateClientApiResource = async (clientId: string, apiResourceId: string | null) => {
  return prisma.client.update({ where: { id: clientId }, data: { apiResourceId } });
};

export const updateClientAuthStrategies = async (clientId: string, strategies: ClientAuthStrategies) => {
  return prisma.client.update({ where: { id: clientId }, data: { authStrategies: strategies } });
};

export const updateClientAllowedScopes = async (clientId: string, scopes: string[]) => {
  const canonical = canonicalizeAllowedScopes(scopes);
  return prisma.client.update({ where: { id: clientId }, data: { allowedScopes: canonical } });
};

export const updateClientReauthTtl = async (clientId: string, reauthTtlSeconds: number) => {
  return prisma.client.update({ where: { id: clientId }, data: { reauthTtlSeconds } });
};

export const updateClientSigningAlgorithms = async (
  clientId: string,
  options: { idTokenAlg: JwtSigningAlg | null; accessTokenAlg: JwtSigningAlg | null },
) => {
  return prisma.client.update({
    where: { id: clientId },
    data: {
      idTokenSignedResponseAlg: options.idTokenAlg,
      accessTokenSigningAlg: options.accessTokenAlg,
    },
  });
};

export const getClientSecret = async (clientId: string): Promise<string | null> => {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { clientSecretEncrypted: true },
  });
  if (!client?.clientSecretEncrypted) {
    return null;
  }
  try {
    return decrypt(client.clientSecretEncrypted);
  } catch (error) {
    console.error("Unable to decrypt client secret", error);
    return null;
  }
};
