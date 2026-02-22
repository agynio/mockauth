import { nanoid } from "nanoid";

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";
import { hashSecret } from "@/server/crypto/hash";
import { encrypt, decrypt } from "@/server/crypto/key-vault";
import { generateOpaqueToken } from "@/server/crypto/opaque-token";
import { DomainError } from "@/server/errors";
import { classifyRedirect } from "@/server/oidc/redirect-uri";
import type { ClientAuthStrategies } from "@/server/oidc/auth-strategy";
import { DEFAULT_CLIENT_AUTH_STRATEGIES } from "@/server/oidc/auth-strategy";

export const getClientForTenant = async (tenantId: string, clientId: string) => {
  const client = await prisma.client.findFirst({
    where: { tenantId, clientId },
    include: { redirectUris: true },
  });

  if (!client) {
    throw new DomainError("Unknown client", { status: 400, code: "invalid_client" });
  }

  return client;
};

export const createClient = async (
  tenantId: string,
  data: { name: string; clientType: "PUBLIC" | "CONFIDENTIAL"; redirectUris?: string[] },
) => {
  const clientId = `client_${nanoid(16)}`;
  let clientSecret: string | null = null;
  let clientSecretHash: string | null = null;
  let clientSecretEncrypted: string | null = null;

  if (data.clientType === "CONFIDENTIAL") {
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
        clientType: data.clientType,
        clientSecretHash,
        clientSecretEncrypted,
        tokenEndpointAuthMethod: data.clientType === "PUBLIC" ? "none" : "client_secret_basic",
        authStrategies: DEFAULT_CLIENT_AUTH_STRATEGIES,
      },
    });

    if (data.redirectUris?.length) {
      for (const raw of data.redirectUris) {
        const { normalized, type } = classifyRedirect(raw);
        await tx.redirectUri.create({ data: { clientId: created.id, uri: normalized, type } });
      }
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

export const getClientByIdForTenant = async (tenantId: string, clientInternalId: string) => {
  const client = await prisma.client.findFirst({
    where: { id: clientInternalId, tenantId },
    include: {
      redirectUris: { orderBy: { createdAt: "asc" } },
      tenant: { include: { defaultApiResource: true } },
      apiResource: true,
    },
  });

  if (!client) {
    throw new DomainError("Client not found", { status: 404 });
  }

  return client;
};

export const rotateClientSecret = async (clientId: string) => {
  const secret = generateOpaqueToken(24);
  const clientSecretHash = await hashSecret(secret);
  const clientSecretEncrypted = encrypt(secret);

  await prisma.client.update({
    where: { id: clientId },
    data: { clientSecretHash, clientSecretEncrypted },
  });

  return secret;
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

export const getConfidentialClientSecret = async (clientId: string): Promise<string | null> => {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { clientSecretEncrypted: true, clientType: true },
  });
  if (!client || client.clientType !== "CONFIDENTIAL" || !client.clientSecretEncrypted) {
    return null;
  }
  try {
    return decrypt(client.clientSecretEncrypted);
  } catch (error) {
    console.error("Unable to decrypt client secret", error);
    return null;
  }
};
