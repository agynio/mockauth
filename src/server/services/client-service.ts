import { nanoid } from "nanoid";

import { prisma } from "@/server/db/client";
import { hashSecret } from "@/server/crypto/hash";
import { generateOpaqueToken } from "@/server/crypto/opaque-token";
import { DomainError } from "@/server/errors";
import { classifyRedirect } from "@/server/oidc/redirect-uri";

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

export const createClient = async (tenantId: string, data: { name: string; clientType: "PUBLIC" | "CONFIDENTIAL" }) => {
  const clientId = `client_${nanoid(16)}`;
  let clientSecret: string | null = null;
  let clientSecretHash: string | null = null;

  if (data.clientType === "CONFIDENTIAL") {
    clientSecret = generateOpaqueToken(24);
    clientSecretHash = await hashSecret(clientSecret);
  }

  const client = await prisma.client.create({
    data: {
      name: data.name,
      tenantId,
      clientId,
      clientType: data.clientType,
      clientSecretHash,
      tokenEndpointAuthMethod: data.clientType === "PUBLIC" ? "none" : "client_secret_basic",
    },
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

export const listClients = async (tenantId: string) => {
  return prisma.client.findMany({
    where: { tenantId },
    include: { redirectUris: true },
    orderBy: { createdAt: "desc" },
  });
};
