import { prisma } from "@/server/db/client";

export const findOrCreateMockUser = async (tenantId: string, username: string) => {
  const normalized = username.trim().toLowerCase();
  return prisma.mockUser.upsert({
    where: {
      tenantId_username: {
        tenantId,
        username: normalized,
      },
    },
    update: {},
    create: {
      tenantId,
      username: normalized,
      displayName: username,
    },
  });
};

export const listMockUsers = async (tenantId: string) => {
  return prisma.mockUser.findMany({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
  });
};
