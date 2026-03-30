import { addMinutes } from "date-fns";

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";
import { DomainError } from "@/server/errors";

const PREAUTHORIZED_PICKER_TTL_MINUTES = 5;
export const PREAUTHORIZED_PICKER_TTL_SECONDS = PREAUTHORIZED_PICKER_TTL_MINUTES * 60;

type StartPickerTransactionArgs = {
  tenantId: string;
  apiResourceId: string;
  clientId: string;
  redirectUri: string;
  appState?: string | null;
  appNonce?: string | null;
  appScope: string;
  appCodeChallenge: string;
  appCodeChallengeMethod: string;
  loginHint?: string | null;
  now?: Date;
};

export const startPickerTransaction = async (args: StartPickerTransactionArgs) => {
  const now = args.now ?? new Date();
  return prisma.pickerTransaction.create({
    data: {
      tenantId: args.tenantId,
      apiResourceId: args.apiResourceId,
      clientId: args.clientId,
      redirectUri: args.redirectUri,
      appState: args.appState ?? null,
      appNonce: args.appNonce ?? null,
      appScope: args.appScope,
      appCodeChallenge: args.appCodeChallenge,
      appCodeChallengeMethod: args.appCodeChallengeMethod,
      loginHint: args.loginHint ?? null,
      expiresAt: addMinutes(now, PREAUTHORIZED_PICKER_TTL_MINUTES),
    },
  });
};

const pickerTransactionInclude = {
  client: { include: { proxyConfig: true } },
  tenant: true,
  apiResource: true,
} satisfies Prisma.PickerTransactionInclude;

export type PickerTransactionWithRelations = Prisma.PickerTransactionGetPayload<{ include: typeof pickerTransactionInclude }>;

export const getPickerTransaction = async (id: string): Promise<PickerTransactionWithRelations | null> => {
  return prisma.pickerTransaction.findUnique({
    where: { id },
    include: pickerTransactionInclude,
  });
};

export const requirePickerTransaction = async (id: string, now = new Date()) => {
  const transaction = await getPickerTransaction(id);
  if (!transaction) {
    throw new DomainError("Picker transaction not found", { status: 400, code: "invalid_request" });
  }
  if (transaction.consumedAt) {
    throw new DomainError("Picker transaction already used", { status: 400, code: "invalid_request" });
  }
  if (transaction.expiresAt < now) {
    throw new DomainError("Picker transaction expired", { status: 400, code: "invalid_request" });
  }
  return transaction;
};

export const markPickerTransactionConsumed = async (id: string) => {
  await prisma.pickerTransaction.delete({ where: { id } });
};
