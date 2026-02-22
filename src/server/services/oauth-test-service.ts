import { prisma } from "@/server/db/client";

type CreateSessionInput = {
  id: string;
  clientId: string;
  tenantId: string;
  redirectUri: string;
  scopes: string;
  codeVerifier: string;
  clientSecret?: string | null;
  nonce?: string | null;
  expiresAt: Date;
};

export const createOauthTestSession = async (input: CreateSessionInput) => {
  const { id, clientId, tenantId, redirectUri, scopes, codeVerifier, clientSecret, nonce, expiresAt } = input;
  await prisma.oAuthTestSession.create({
    data: {
      id,
      clientId,
      tenantId,
      redirectUri,
      scopes,
      codeVerifier,
      clientSecret: clientSecret ?? null,
      nonce: nonce ?? null,
      expiresAt,
    },
  });
};

export const consumeOauthTestSession = async (id: string) => {
  const session = await prisma.oAuthTestSession.findUnique({ where: { id } });
  if (!session) {
    return null;
  }
  await prisma.oAuthTestSession.delete({ where: { id } });
  return session;
};
