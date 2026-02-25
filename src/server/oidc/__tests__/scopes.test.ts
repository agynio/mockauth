import { describe, expect, it } from "vitest";

import { isSupportedScope, normalizeScopes, SUPPORTED_SCOPES } from "@/server/oidc/scopes";

describe("OIDC scopes", () => {
  it("normalizes scope values", () => {
    const result = normalizeScopes([" OpenID ", "profile", "EMAIL", "profile", ""]);
    expect(result).toEqual(["openid", "profile", "email"]);
  });

  it("preserves insertion order for unique scopes", () => {
    const result = normalizeScopes(["email", "profile", "email", "openid"]);
    expect(result).toEqual(["email", "profile", "openid"]);
  });

  it("detects supported scopes", () => {
    for (const scope of SUPPORTED_SCOPES) {
      expect(isSupportedScope(scope)).toBe(true);
    }
    expect(isSupportedScope("offline_access")).toBe(false);
  });
});
