import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  NEXTAUTH_URL: z.string().min(1).optional(),
  NEXTAUTH_SECRET: z.string().min(32, "NEXTAUTH_SECRET must be at least 32 characters"),
  DATABASE_URL: z.string().url(),
  LOGTO_ISSUER: z.string().url(),
  LOGTO_CLIENT_ID: z.string().min(1),
  LOGTO_CLIENT_SECRET: z.string().min(1),
  MOCKAUTH_KEY_ENCRYPTION_SECRET: z.string().min(32, "Provide a strong encryption secret for tenant keys"),
  MOCKAUTH_ALLOW_ANY_REDIRECT: z
    .enum(["true", "false"])
    .optional()
    .default("false")
    .transform((value) => value === "true"),
  ENABLE_TEST_ROUTES: z
    .enum(["true", "false"])
    .optional()
    .default("false")
    .transform((value) => value === "true"),
  ALLOW_EMAIL_LINKING: z
    .enum(["true", "false"])
    .optional()
    .default("false")
    .transform((value) => value === "true"),
  MOCKAUTH_ALLOW_INSECURE_TEST_COOKIE: z
    .enum(["true", "false"])
    .optional()
    .default("false")
    .transform((value) => value === "true"),
});

export const env = envSchema.parse({
  NODE_ENV: process.env.NODE_ENV,
  NEXTAUTH_URL: process.env.NEXTAUTH_URL,
  NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET,
  DATABASE_URL: process.env.DATABASE_URL,
  LOGTO_ISSUER: process.env.LOGTO_ISSUER,
  LOGTO_CLIENT_ID: process.env.LOGTO_CLIENT_ID,
  LOGTO_CLIENT_SECRET: process.env.LOGTO_CLIENT_SECRET,
  MOCKAUTH_KEY_ENCRYPTION_SECRET: process.env.MOCKAUTH_KEY_ENCRYPTION_SECRET,
  MOCKAUTH_ALLOW_ANY_REDIRECT: process.env.MOCKAUTH_ALLOW_ANY_REDIRECT,
  ENABLE_TEST_ROUTES: process.env.ENABLE_TEST_ROUTES,
  ALLOW_EMAIL_LINKING: process.env.ALLOW_EMAIL_LINKING,
  MOCKAUTH_ALLOW_INSECURE_TEST_COOKIE: process.env.MOCKAUTH_ALLOW_INSECURE_TEST_COOKIE,
});

export const isProd = env.NODE_ENV === "production";
