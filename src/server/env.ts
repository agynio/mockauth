import { randomBytes } from "node:crypto";
import { z } from "zod";

const isVercel = process.env.VERCEL === "1" || Boolean(process.env.VERCEL);
const vercelEnv = process.env.VERCEL_ENV;
const isPreview = isVercel && vercelEnv !== "production";
let previewFallbackWarned = false;

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
  AUDIT_LOG_RETENTION_DAYS: z.preprocess(
    (value) => (value === undefined ? undefined : Number(value)),
    z.number().int().min(1).default(90),
  ),
  CRON_SECRET: z.string().min(1).optional(),
});

const buildRawEnv = () => {
  const raw: Record<string, string | undefined> = {
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
    AUDIT_LOG_RETENTION_DAYS: process.env.AUDIT_LOG_RETENTION_DAYS,
    CRON_SECRET: process.env.CRON_SECRET,
  } satisfies Record<string, string | undefined>;

  if (!isPreview) {
    return raw;
  }

  const fallbackLog: string[] = [];

  const ensureValue = (key: keyof typeof raw, value: string) => {
    if (!raw[key]) {
      raw[key] = value;
      fallbackLog.push(key);
    }
  };

  ensureValue("NEXTAUTH_URL", "https://preview.mockauth.invalid");
  ensureValue("NEXTAUTH_SECRET", randomBytes(48).toString("hex"));
  ensureValue("DATABASE_URL", "postgresql://preview:preview@127.0.0.1:5432/preview");
  ensureValue("LOGTO_ISSUER", "https://preview.logto.invalid");
  ensureValue("LOGTO_CLIENT_ID", "preview-client-id");
  ensureValue("LOGTO_CLIENT_SECRET", "preview-client-secret");
  ensureValue("MOCKAUTH_KEY_ENCRYPTION_SECRET", randomBytes(48).toString("hex"));

  if (fallbackLog.length > 0 && !previewFallbackWarned) {
    previewFallbackWarned = true;
    console.warn(
      `[env] Using preview fallbacks for missing variables: ${fallbackLog.join(", ")}. Provide real values in Vercel project settings to fully exercise the app.`,
    );
  }

  return raw;
};

export const env = envSchema.parse(buildRawEnv());

export const isProd = env.NODE_ENV === "production";
