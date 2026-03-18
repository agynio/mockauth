import { addMinutes } from "date-fns";

import type { Prisma } from "@/generated/prisma/client";
import { $Enums } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";
import { generateOpaqueToken, hashOpaqueToken } from "@/server/crypto/opaque-token";
import { DomainError } from "@/server/errors";

const CODE_TTL_MINUTES = 10;

export const createAuthorizationCode = async (params: {
  tenantId: string;
  clientId: string;
  apiResourceId: string;
  userId: string;
  loginStrategy: $Enums.LoginStrategy;
  subject: string;
  emailVerifiedOverride?: boolean;
  redirectUri: string;
  scope: string;
  nonce?: string;
  state?: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  traceId?: string | null;
}) => {
  const code = generateOpaqueToken();
  await prisma.authorizationCode.create({
    data: {
      tenantId: params.tenantId,
      clientId: params.clientId,
      apiResourceId: params.apiResourceId,
      userId: params.userId,
      loginStrategy: params.loginStrategy,
      subject: params.subject,
      emailVerifiedOverride: params.emailVerifiedOverride ?? null,
      redirectUri: params.redirectUri,
      scope: params.scope,
      nonce: params.nonce,
      state: params.state,
      codeChallenge: params.codeChallenge,
      codeChallengeMethod: params.codeChallengeMethod,
      traceId: params.traceId ?? null,
      expiresAt: addMinutes(new Date(), CODE_TTL_MINUTES),
      codeHash: hashOpaqueToken(code),
    },
  });

  return code;
};

const codeInclude = {
  tenant: true,
  client: { include: { redirectUris: true } },
  user: true,
} satisfies Prisma.AuthorizationCodeInclude;

export type AuthorizationCodeWithRelations = Prisma.AuthorizationCodeGetPayload<{ include: typeof codeInclude }>;

export const consumeAuthorizationCode = async (code: string): Promise<AuthorizationCodeWithRelations> => {
  const record = await prisma.authorizationCode.findUnique({
    where: { codeHash: hashOpaqueToken(code) },
    include: codeInclude,
  });

  if (!record) {
    throw new DomainError("Invalid authorization code", { status: 400, code: "invalid_grant" });
  }

  if (record.consumedAt || record.expiresAt < new Date()) {
    throw new DomainError("Authorization code expired", { status: 400, code: "invalid_grant" });
  }

  await prisma.authorizationCode.update({
    where: { id: record.id },
    data: { consumedAt: new Date() },
  });

  return record;
};
