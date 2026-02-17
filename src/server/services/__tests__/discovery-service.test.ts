import { describe, expect, it } from "vitest";

import { buildDiscoveryDocument } from "@/server/services/discovery-service";

describe("discovery document", () => {
  it("generates tenant-specific endpoints", () => {
    const doc = buildDiscoveryDocument("https://mockauth.test", "tenant_123");
    expect(doc.issuer).toBe("https://mockauth.test/t/tenant_123/oidc");
    expect(doc.authorization_endpoint).toBe("https://mockauth.test/t/tenant_123/oidc/authorize");
    expect(doc.jwks_uri).toBe("https://mockauth.test/t/tenant_123/oidc/jwks.json");
  });
});
