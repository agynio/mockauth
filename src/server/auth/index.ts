import NextAuth from "next-auth";

import { authOptions } from "./options";

export const { handlers, auth, signIn, signOut } = NextAuth(authOptions);
