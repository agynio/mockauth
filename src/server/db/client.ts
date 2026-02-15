import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

import { PrismaClient } from "@/generated/prisma/client";
import { env, isProd } from "@/server/env";

type PrismaWithAlias = PrismaClient & {
  user: PrismaClient["adminUser"];
};

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaWithAlias;
};

const createClient = (): PrismaWithAlias => {
  const pool = new Pool({ connectionString: env.DATABASE_URL });
  const adapter = new PrismaPg(pool);
  const client = new PrismaClient({ adapter });

  Object.defineProperty(client, "user", {
    get() {
      return client.adminUser;
    },
  });

  return client as PrismaWithAlias;
};

export const prisma: PrismaWithAlias = globalForPrisma.prisma ?? createClient();

if (!isProd) {
  globalForPrisma.prisma = prisma;
}
