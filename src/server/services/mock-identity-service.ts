import { randomUUID } from "node:crypto";

import { prisma } from "@/server/db/client";
import type { ClientAuthStrategy } from "@/server/oidc/auth-strategy";
import { toPrismaLoginStrategy } from "@/server/oidc/auth-strategy";

type IdentityInput = {
  tenantId: string;
  strategy: ClientAuthStrategy;
  identifier: string;
  email?: string | null;
};

const normalizeIdentifier = (identifier: string) => identifier.trim().toLowerCase();

const normalizeEmail = (email?: string | null) => {
  if (!email) {
    return null;
  }
  return email.trim().toLowerCase();
};

export const findOrCreateMockIdentity = async ({ tenantId, strategy, identifier, email }: IdentityInput) => {
  const normalizedIdentifier = normalizeIdentifier(identifier);
  const normalizedEmail = strategy === "email" ? normalizeEmail(email ?? identifier) : normalizeEmail(email);
  const prismaStrategy = toPrismaLoginStrategy(strategy);
  return prisma.mockIdentity.upsert({
    where: {
      tenantId_strategy_identifier: {
        tenantId,
        strategy: prismaStrategy,
        identifier: normalizedIdentifier,
      },
    },
    update: normalizedEmail ? { email: normalizedEmail } : {},
    create: {
      tenantId,
      strategy: prismaStrategy,
      identifier: normalizedIdentifier,
      sub: randomUUID(),
      email: normalizedEmail,
    },
  });
};

export const resolveStableSubject = async (input: IdentityInput) => {
  const identity = await findOrCreateMockIdentity(input);
  return identity.sub;
};
