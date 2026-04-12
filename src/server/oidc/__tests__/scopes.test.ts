import { describe, expect, it } from "vitest";

import { isSupportedScope, isValidScopeValue, normalizeScopes, SUPPORTED_SCOPES } from "@/server/oidc/scopes";

describe("OIDC scopes", () => {
  it("normalizes scope values", () => {
    const result = normalizeScopes([" OpenID ", "profile", "EMAIL", "profile", ""]);
    expect(result).toEqual(["OpenID", "profile", "EMAIL"]);
  });

  it("preserves insertion order for unique scopes", () => {
    const result = normalizeScopes(["email", "Profile", "email", "profile", "openid"]);
    expect(result).toEqual(["email", "Profile", "profile", "openid"]);
  });

  it("detects supported scopes", () => {
    for (const scope of SUPPORTED_SCOPES) {
      expect(isSupportedScope(scope)).toBe(true);
    }
    expect(isSupportedScope("offline_access")).toBe(true);
  });

  it("validates scope values", () => {
    expect(isValidScopeValue("openid")).toBe(true);
    expect(isValidScopeValue("tenant:admin")).toBe(true);
    expect(isValidScopeValue("invalid scope")).toBe(false);
    expect(isValidScopeValue("UPPERCASE")).toBe(true);
    expect(isValidScopeValue("r_organizationSocialAnalytics")).toBe(true);
    expect(isValidScopeValue("a".repeat(65))).toBe(false);
  });
});
