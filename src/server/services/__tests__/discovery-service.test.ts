import { describe, expect, it } from "vitest";

import { buildDiscoveryDocument } from "@/server/services/discovery-service";

describe("discovery document", () => {
  it("generates resource-specific endpoints", () => {
    const doc = buildDiscoveryDocument("https://mockauth.test", "resource_999");
    expect(doc.issuer).toBe("https://mockauth.test/r/resource_999/oidc");
    expect(doc.authorization_endpoint).toBe("https://mockauth.test/r/resource_999/oidc/authorize");
    expect(doc.end_session_endpoint).toBe("https://mockauth.test/r/resource_999/oidc/end-session");
    expect(doc.jwks_uri).toBe("https://mockauth.test/r/resource_999/oidc/jwks.json");
    expect(doc.id_token_signing_alg_values_supported).toEqual(["RS256", "PS256", "ES256", "ES384"]);
  });
});
