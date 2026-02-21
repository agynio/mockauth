import { $Enums } from "@/generated/prisma/client";

export type ClientAuthStrategy = "username" | "email";
export type SubjectSource = "entered" | "generated_uuid";
export const SUBJECT_SOURCE_OPTIONS: SubjectSource[] = ["entered", "generated_uuid"];

export const EMAIL_VERIFIED_MODES = ["true", "false", "user_choice"] as const;
export type EmailVerifiedMode = (typeof EMAIL_VERIFIED_MODES)[number];

type StrategyConfigBase = {
  enabled: boolean;
  subSource: SubjectSource;
};

export type UsernameStrategyConfig = StrategyConfigBase;
export type EmailStrategyConfig = StrategyConfigBase & { emailVerifiedMode: EmailVerifiedMode };

export type ClientAuthStrategies = {
  username: UsernameStrategyConfig;
  email: EmailStrategyConfig;
};

export const DEFAULT_CLIENT_AUTH_STRATEGIES: ClientAuthStrategies = {
  username: { enabled: true, subSource: "entered" },
  email: { enabled: false, subSource: "entered", emailVerifiedMode: "false" },
};

const isSubjectSource = (value: unknown): value is SubjectSource => SUBJECT_SOURCE_OPTIONS.includes(value as SubjectSource);
const isEmailVerifiedMode = (value: unknown): value is EmailVerifiedMode =>
  EMAIL_VERIFIED_MODES.includes(value as EmailVerifiedMode);

const normalizeConfigBase = (value: unknown, fallback: StrategyConfigBase): StrategyConfigBase => {
  if (!value || typeof value !== "object") {
    return fallback;
  }
  const candidate = value as Partial<StrategyConfigBase>;
  return {
    enabled: typeof candidate.enabled === "boolean" ? candidate.enabled : fallback.enabled,
    subSource: isSubjectSource(candidate.subSource) ? candidate.subSource : fallback.subSource,
  };
};

const normalizeUsernameConfig = (
  value: unknown,
  fallback: UsernameStrategyConfig,
): UsernameStrategyConfig => ({
  ...normalizeConfigBase(value, fallback),
});

const normalizeEmailConfig = (value: unknown, fallback: EmailStrategyConfig): EmailStrategyConfig => {
  const base = normalizeConfigBase(value, fallback);
  const candidate = value && typeof value === "object" ? (value as Partial<EmailStrategyConfig>) : {};
  const emailVerifiedMode = isEmailVerifiedMode(candidate.emailVerifiedMode)
    ? candidate.emailVerifiedMode
    : fallback.emailVerifiedMode;
  return { ...base, emailVerifiedMode };
};

export const parseClientAuthStrategies = (value: unknown): ClientAuthStrategies => {
  if (!value || typeof value !== "object") {
    return DEFAULT_CLIENT_AUTH_STRATEGIES;
  }
  const candidate = value as Partial<ClientAuthStrategies>;
  return {
    username: normalizeUsernameConfig(candidate.username, DEFAULT_CLIENT_AUTH_STRATEGIES.username),
    email: normalizeEmailConfig(candidate.email, DEFAULT_CLIENT_AUTH_STRATEGIES.email),
  };
};

export const hasEnabledStrategy = (strategies: ClientAuthStrategies) =>
  strategies.username.enabled || strategies.email.enabled;

export const toPrismaLoginStrategy = (strategy: ClientAuthStrategy): $Enums.LoginStrategy =>
  strategy === "username" ? $Enums.LoginStrategy.USERNAME : $Enums.LoginStrategy.EMAIL;

export const fromPrismaLoginStrategy = (strategy: $Enums.LoginStrategy): ClientAuthStrategy =>
  (strategy === $Enums.LoginStrategy.USERNAME ? "username" : "email");
