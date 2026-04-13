import { addSeconds } from "date-fns";

import { $Enums } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";
import { generateOpaqueToken, hashOpaqueToken } from "@/server/crypto/opaque-token";
import { env } from "@/server/env";

export const MOCK_SESSION_COOKIE = "mockauth_enduser_session";

export const createSession = async (
  tenantId: string,
  userId: string,
  data: { strategy: $Enums.LoginStrategy; subject: string; emailVerifiedOverride?: boolean },
) => {
  const token = generateOpaqueToken();
  await prisma.mockSession.create({
    data: {
      tenantId,
      userId,
      loginStrategy: data.strategy,
      subject: data.subject,
      emailVerifiedOverride: data.emailVerifiedOverride ?? null,
      sessionTokenHash: hashOpaqueToken(token),
      expiresAt: addSeconds(new Date(), env.MOCKAUTH_SESSION_TTL_SECONDS),
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
