import { PrismaAdapter } from "@next-auth/prisma-adapter";
import type { Adapter } from "next-auth/adapters";
import type { NextAuthOptions } from "next-auth";

import LogtoProvider from "@/server/auth/logto-provider";
import { prisma } from "@/server/db/client";
import { env } from "@/server/env";

const sanitizeAdapterUser = <T extends Record<string, unknown>>(user: T) => {
  if (!user) {
    return user;
  }
  const { emailVerified, ...rest } = user as Record<string, unknown>;
  if (emailVerified === undefined) {
    return user;
  }
  return rest as T;
};

const prismaAdapter = PrismaAdapter(prisma);
type CreateUserData = Parameters<typeof prismaAdapter.createUser>[0];
type UpdateUserData = Parameters<NonNullable<typeof prismaAdapter.updateUser>>[0];
const adapter: Adapter = {
  ...prismaAdapter,
  async createUser(data: CreateUserData) {
    return prismaAdapter.createUser(sanitizeAdapterUser(data));
  },
  async updateUser(data: UpdateUserData) {
    if (!prismaAdapter.updateUser) {
      throw new Error("Prisma adapter is missing updateUser");
    }
    return prismaAdapter.updateUser(sanitizeAdapterUser(data));
  },
};

export const authOptions: NextAuthOptions = {
  adapter,
  providers: [
    LogtoProvider({
      issuer: env.LOGTO_ISSUER,
      clientId: env.LOGTO_CLIENT_ID,
      clientSecret: env.LOGTO_CLIENT_SECRET,
      scope: "openid profile email",
    }),
  ],
  session: {
    strategy: "database",
  },
  callbacks: {
    async session({ session, user }) {
      if (session.user) {
        session.user.id = user.id;
        session.user.logtoSub = (user as { logtoSub?: string }).logtoSub;
      }
      return session;
    },
  },
  events: {
    async signIn({ user, profile }) {
      if (!profile?.sub) {
        return;
      }

      await prisma.adminUser.update({
        where: { id: user.id },
        data: { logtoSub: profile.sub, email: user.email, name: user.name },
      });
    },
  },
};
