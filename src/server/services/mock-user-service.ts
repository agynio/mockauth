import { prisma } from "@/server/db/client";

export const findOrCreateMockUser = async (
  tenantId: string,
  identifier: string,
  options?: { displayName?: string; email?: string | null },
) => {
  const normalized = identifier.trim().toLowerCase();
  const displayName = options?.displayName ?? identifier.trim();
  const email = options?.email ? options.email.trim().toLowerCase() : null;
  return prisma.mockUser.upsert({
    where: {
      tenantId_username: {
        tenantId,
        username: normalized,
      },
    },
    update: email ? { email } : {},
    create: {
      tenantId,
      username: normalized,
      displayName,
      email,
    },
  });
};

export const listMockUsers = async (tenantId: string) => {
  return prisma.mockUser.findMany({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
  });
};
