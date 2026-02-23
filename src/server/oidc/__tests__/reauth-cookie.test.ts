import { describe, it, expect, vi } from "vitest";

import { createReauthCookieValue, verifyReauthCookieValue } from "../reauth-cookie";

const TENANT_ID = "tenant_qa";
const API_RESOURCE_ID = "resource_123";
const CLIENT_ID = "qa-client";
const SESSION_HASH = "session_hash";

describe("reauth-cookie", () => {
  it("creates and validates a signed cookie", () => {
    const value = createReauthCookieValue({
      tenantId: TENANT_ID,
      apiResourceId: API_RESOURCE_ID,
      clientId: CLIENT_ID,
      sessionHash: SESSION_HASH,
      ttlSeconds: 120,
    });

    expect(value).toBeTruthy();
    const valid = verifyReauthCookieValue(value!, {
      tenantId: TENANT_ID,
      apiResourceId: API_RESOURCE_ID,
      clientId: CLIENT_ID,
      sessionHash: SESSION_HASH,
    });
    expect(valid).toBe(true);
  });

  it("rejects tampered cookies", () => {
    const value = createReauthCookieValue({
      tenantId: TENANT_ID,
      apiResourceId: API_RESOURCE_ID,
      clientId: CLIENT_ID,
      sessionHash: SESSION_HASH,
      ttlSeconds: 120,
    });
    expect(value).toBeTruthy();
    const parts = value!.split(".");
    parts[1] = Buffer.from(JSON.stringify({
      tenantId: TENANT_ID,
      apiResourceId: "other",
      clientId: CLIENT_ID,
      sessionHash: SESSION_HASH,
      exp: Math.floor(Date.now() / 1000) + 120,
    })).toString("base64url");
    const modified = parts.join(".");
    const valid = verifyReauthCookieValue(modified, {
      tenantId: TENANT_ID,
      apiResourceId: API_RESOURCE_ID,
      clientId: CLIENT_ID,
      sessionHash: SESSION_HASH,
    });
    expect(valid).toBe(false);
  });

  it("rejects expired cookies", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2024-01-01T00:00:00Z"));
      const value = createReauthCookieValue({
        tenantId: TENANT_ID,
        apiResourceId: API_RESOURCE_ID,
        clientId: CLIENT_ID,
        sessionHash: SESSION_HASH,
        ttlSeconds: 1,
      });
      vi.setSystemTime(new Date("2024-01-01T00:00:05Z"));
      const valid = verifyReauthCookieValue(value!, {
        tenantId: TENANT_ID,
        apiResourceId: API_RESOURCE_ID,
        clientId: CLIENT_ID,
        sessionHash: SESSION_HASH,
      });
      expect(valid).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
