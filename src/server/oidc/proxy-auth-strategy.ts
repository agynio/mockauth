export type ProxyAuthStrategy = "redirect" | "preauthorized";

type ProxyAuthStrategyConfig = {
  enabled: boolean;
};

export type ProxyAuthStrategies = {
  redirect: ProxyAuthStrategyConfig;
  preauthorized: ProxyAuthStrategyConfig;
};

export const DEFAULT_PROXY_AUTH_STRATEGIES: ProxyAuthStrategies = {
  redirect: { enabled: true },
  preauthorized: { enabled: false },
};

const normalizeConfig = (value: unknown, fallback: ProxyAuthStrategyConfig): ProxyAuthStrategyConfig => {
  if (!value || typeof value !== "object") {
    return fallback;
  }
  const candidate = value as Partial<ProxyAuthStrategyConfig>;
  return {
    enabled: typeof candidate.enabled === "boolean" ? candidate.enabled : fallback.enabled,
  };
};

export const parseProxyAuthStrategies = (value: unknown): ProxyAuthStrategies => {
  if (!value || typeof value !== "object") {
    return DEFAULT_PROXY_AUTH_STRATEGIES;
  }
  const candidate = value as Partial<ProxyAuthStrategies>;
  return {
    redirect: normalizeConfig(candidate.redirect, DEFAULT_PROXY_AUTH_STRATEGIES.redirect),
    preauthorized: normalizeConfig(candidate.preauthorized, DEFAULT_PROXY_AUTH_STRATEGIES.preauthorized),
  };
};

export const hasEnabledProxyStrategy = (strategies: ProxyAuthStrategies) =>
  strategies.redirect.enabled || strategies.preauthorized.enabled;

export const enabledProxyStrategies = (strategies: ProxyAuthStrategies): ProxyAuthStrategy[] => {
  const enabled: ProxyAuthStrategy[] = [];
  if (strategies.redirect.enabled) {
    enabled.push("redirect");
  }
  if (strategies.preauthorized.enabled) {
    enabled.push("preauthorized");
  }
  return enabled;
};
