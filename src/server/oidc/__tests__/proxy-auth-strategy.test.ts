import { describe, expect, it } from "vitest";

import {
  DEFAULT_PROXY_AUTH_STRATEGIES,
  enabledProxyStrategies,
  hasEnabledProxyStrategy,
  parseProxyAuthStrategies,
} from "@/server/oidc/proxy-auth-strategy";

describe("proxy auth strategy helpers", () => {
  it("parses a complete proxy auth strategy payload", () => {
    const parsed = parseProxyAuthStrategies({
      redirect: { enabled: false },
      preauthorized: { enabled: true },
    });

    expect(parsed).toEqual({
      redirect: { enabled: false },
      preauthorized: { enabled: true },
    });
  });

  it("fills missing strategies with defaults", () => {
    const parsed = parseProxyAuthStrategies({ redirect: { enabled: false } });

    expect(parsed).toEqual({
      redirect: { enabled: false },
      preauthorized: { enabled: DEFAULT_PROXY_AUTH_STRATEGIES.preauthorized.enabled },
    });
  });

  it("uses defaults for invalid strategy values", () => {
    const parsed = parseProxyAuthStrategies({
      redirect: { enabled: "yes" },
      preauthorized: { enabled: null },
    });

    expect(parsed).toEqual(DEFAULT_PROXY_AUTH_STRATEGIES);
  });

  it("falls back to defaults for non-object input", () => {
    expect(parseProxyAuthStrategies("invalid" as unknown)).toEqual(DEFAULT_PROXY_AUTH_STRATEGIES);
  });

  it("detects enabled strategies", () => {
    expect(
      hasEnabledProxyStrategy({
        redirect: { enabled: false },
        preauthorized: { enabled: false },
      }),
    ).toBe(false);

    expect(
      hasEnabledProxyStrategy({
        redirect: { enabled: true },
        preauthorized: { enabled: false },
      }),
    ).toBe(true);
  });

  it("lists enabled strategies in priority order", () => {
    expect(
      enabledProxyStrategies({
        redirect: { enabled: true },
        preauthorized: { enabled: true },
      }),
    ).toEqual(["redirect", "preauthorized"]);

    expect(
      enabledProxyStrategies({
        redirect: { enabled: false },
        preauthorized: { enabled: true },
      }),
    ).toEqual(["preauthorized"]);
  });
});
