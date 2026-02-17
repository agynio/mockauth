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
  ENABLE_TEST_ROUTES: z
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
  ENABLE_TEST_ROUTES: process.env.ENABLE_TEST_ROUTES,
});

export const isProd = env.NODE_ENV === "production";
