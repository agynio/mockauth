import NextAuth from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email?: string | null;
      name?: string | null;
      logtoSub?: string;
    };
  }

  interface User {
    logtoSub?: string;
  }
}
