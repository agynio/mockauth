import { randomUUID } from "crypto";

import { addSeconds } from "date-fns";

import { Prisma, type LoginStrategy } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";
import { generateOpaqueToken, hashOpaqueToken } from "@/server/crypto/opaque-token";

type RefreshTokenCreateInput = {
  tenantId: string;
  clientId: string;
  apiResourceId: string;
  userId: string;
  loginStrategy: LoginStrategy;
  subject: string;
  emailVerifiedOverride?: boolean | null;
  scope: string;
  refreshTokenTtlSeconds: number;
  familyId?: string;
  now?: Date;
};

export const createRefreshToken = async (
  input: RefreshTokenCreateInput,
  tx?: Prisma.TransactionClient,
): Promise<{ token: string; familyId: string }> => {
  const token = generateOpaqueToken();
  const familyId = input.familyId ?? randomUUID();
  const now = input.now ?? new Date();
  const db = tx ?? prisma;

  await db.refreshToken.create({
    data: {
      tenantId: input.tenantId,
      clientId: input.clientId,
      apiResourceId: input.apiResourceId,
      userId: input.userId,
      loginStrategy: input.loginStrategy,
      subject: input.subject,
      emailVerifiedOverride: input.emailVerifiedOverride ?? null,
      familyId,
      tokenHash: hashOpaqueToken(token),
      scope: input.scope,
      expiresAt: addSeconds(now, input.refreshTokenTtlSeconds),
    },
  });

  return { token, familyId };
};

export const revokeRefreshTokenFamily = async (
  familyId: string,
  now: Date = new Date(),
  tx?: Prisma.TransactionClient,
) => {
  const db = tx ?? prisma;
  await db.refreshToken.updateMany({
    where: { familyId, revokedAt: null },
    data: { revokedAt: now },
  });
};

export const revokeRefreshTokensForUser = async (params: {
  tenantId: string;
  userId: string;
  clientId?: string | null;
}) => {
  const now = new Date();
  await prisma.refreshToken.updateMany({
    where: {
      tenantId: params.tenantId,
      userId: params.userId,
      clientId: params.clientId ?? undefined,
      revokedAt: null,
    },
    data: { revokedAt: now },
  });
};
