import { $Enums } from "@/generated/prisma/client";

export type ClientAuthStrategy = "username" | "email";
export type SubjectSource = "entered" | "generated_uuid";

export type StrategyConfig = {
  enabled: boolean;
  subSource: SubjectSource;
};

export type ClientAuthStrategies = Record<ClientAuthStrategy, StrategyConfig>;

export const SUBJECT_SOURCE_OPTIONS: SubjectSource[] = ["entered", "generated_uuid"];

export const DEFAULT_CLIENT_AUTH_STRATEGIES: ClientAuthStrategies = {
  username: { enabled: true, subSource: "entered" },
  email: { enabled: false, subSource: "entered" },
};

const isSubjectSource = (value: unknown): value is SubjectSource => SUBJECT_SOURCE_OPTIONS.includes(value as SubjectSource);

const normalizeConfig = (value: unknown, fallback: StrategyConfig): StrategyConfig => {
  if (!value || typeof value !== "object") {
    return fallback;
  }
  const candidate = value as Partial<StrategyConfig>;
  return {
    enabled: typeof candidate.enabled === "boolean" ? candidate.enabled : fallback.enabled,
    subSource: isSubjectSource(candidate.subSource) ? candidate.subSource : fallback.subSource,
  };
};

export const parseClientAuthStrategies = (value: unknown): ClientAuthStrategies => {
  if (!value || typeof value !== "object") {
    return DEFAULT_CLIENT_AUTH_STRATEGIES;
  }
  const candidate = value as Partial<ClientAuthStrategies>;
  return {
    username: normalizeConfig(candidate.username, DEFAULT_CLIENT_AUTH_STRATEGIES.username),
    email: normalizeConfig(candidate.email, DEFAULT_CLIENT_AUTH_STRATEGIES.email),
  };
};

export const hasEnabledStrategy = (strategies: ClientAuthStrategies) =>
  strategies.username.enabled || strategies.email.enabled;

export const toPrismaLoginStrategy = (strategy: ClientAuthStrategy): $Enums.LoginStrategy =>
  strategy === "username" ? $Enums.LoginStrategy.USERNAME : $Enums.LoginStrategy.EMAIL;

export const fromPrismaLoginStrategy = (strategy: $Enums.LoginStrategy): ClientAuthStrategy =>
  (strategy === $Enums.LoginStrategy.USERNAME ? "username" : "email");
