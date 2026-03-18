import { describe, expect, it } from "vitest";

import { createAuthOptions } from "@/server/auth/options";

type AppEnv = typeof import("@/server/env").env;

const baseEnv: AppEnv = {
  NODE_ENV: "test",
  NEXTAUTH_URL: "http://127.0.0.1:3000",
  NEXTAUTH_SECRET: "abcdefghijklmnopqrstuvwxyz123456",
  DATABASE_URL: "postgresql://mockauth:mockauth@localhost:5432/mockauth",
  LOGTO_ISSUER: "http://127.0.0.1:3000/api/test/logto",
  LOGTO_CLIENT_ID: "client-id",
  LOGTO_CLIENT_SECRET: "client-secret",
  MOCKAUTH_KEY_ENCRYPTION_SECRET: "abcdefghijklmnopqrstuvwxyz123456",
  MOCKAUTH_ALLOW_ANY_REDIRECT: false,
  ENABLE_TEST_ROUTES: true,
  ALLOW_EMAIL_LINKING: false,
  MOCKAUTH_ALLOW_INSECURE_TEST_COOKIE: false,
  AUDIT_LOG_RETENTION_DAYS: 90,
};

describe("createAuthOptions", () => {
  it("disables dangerous linking by default", () => {
    const options = createAuthOptions(baseEnv);
    const provider = options.providers?.[0];
    expect(
      (provider as { allowDangerousEmailAccountLinking?: boolean } | undefined)?.allowDangerousEmailAccountLinking,
    ).toBe(false);
  });

  it("enables dangerous linking when flag is true", () => {
    const options = createAuthOptions({ ...baseEnv, ALLOW_EMAIL_LINKING: true });
    const provider = options.providers?.[0];
    expect(
      (provider as { allowDangerousEmailAccountLinking?: boolean } | undefined)?.allowDangerousEmailAccountLinking,
    ).toBe(true);
    expect(options.pages?.error).toBe("/auth/error");
  });
});
