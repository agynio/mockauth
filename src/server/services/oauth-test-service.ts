import { prisma } from "@/server/db/client";

type CreateSessionInput = {
  id: string;
  clientId: string;
  adminUserId: string;
  tenantId: string;
  redirectUri: string;
  scopes: string;
  codeVerifier: string;
  nonce?: string | null;
  expiresAt: Date;
};

export const createOauthTestSession = async (input: CreateSessionInput) => {
  const { id, clientId, adminUserId, tenantId, redirectUri, scopes, codeVerifier, nonce, expiresAt } = input;
  await prisma.oAuthTestSession.create({
    data: {
      id,
      clientId,
      adminUserId,
      tenantId,
      redirectUri,
      scopes,
      codeVerifier,
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

export const resetOauthTestSessionsForClient = async (clientId: string, adminUserId: string): Promise<string[]> => {
  const sessions = await prisma.oAuthTestSession.findMany({ where: { clientId, adminUserId }, select: { id: true } });
  if (sessions.length === 0) {
    return [];
  }
  await prisma.oAuthTestSession.deleteMany({ where: { id: { in: sessions.map((session) => session.id) } } });
  return sessions.map((session) => session.id);
};
