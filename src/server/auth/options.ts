import { PrismaAdapter } from "@next-auth/prisma-adapter";
import type { NextAuthOptions } from "next-auth";

import LogtoProvider from "@/server/auth/logto-provider";
import { prisma } from "@/server/db/client";
import { env } from "@/server/env";

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma),
  providers: [
    LogtoProvider({
      issuer: env.LOGTO_ISSUER,
      clientId: env.LOGTO_CLIENT_ID,
      clientSecret: env.LOGTO_CLIENT_SECRET,
      scope: "openid profile email",
    }),
  ],
  pages: {
    signIn: "/admin/sign-in",
  },
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
