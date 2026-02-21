import { addHours } from "date-fns";

import { $Enums } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";
import { generateOpaqueToken, hashOpaqueToken } from "@/server/crypto/opaque-token";

const SESSION_TTL_HOURS = 12;

export const MOCK_SESSION_COOKIE = "mockauth_enduser_session";

export const createSession = async (
  tenantId: string,
  userId: string,
  data: { strategy: $Enums.LoginStrategy; subject: string },
) => {
  const token = generateOpaqueToken();
  await prisma.mockSession.create({
    data: {
      tenantId,
      userId,
      loginStrategy: data.strategy,
      subject: data.subject,
      sessionTokenHash: hashOpaqueToken(token),
      expiresAt: addHours(new Date(), SESSION_TTL_HOURS),
    },
  });

  return token;
};

export const getSessionUser = async (tenantId: string, token?: string) => {
  if (!token) {
    return null;
  }

  const session = await prisma.mockSession.findFirst({
    where: {
      tenantId,
      sessionTokenHash: hashOpaqueToken(token),
      expiresAt: { gt: new Date() },
    },
    include: {
      user: true,
    },
  });

  return session;
};

export const clearSession = async (tenantId: string, token?: string) => {
  if (!token) {
    return;
  }

  await prisma.mockSession.deleteMany({
    where: {
      tenantId,
      sessionTokenHash: hashOpaqueToken(token),
    },
  });
};
