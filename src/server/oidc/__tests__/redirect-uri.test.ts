import { RedirectUriType } from "@/generated/prisma/client";
import { classifyRedirect, resolveRedirectUri } from "@/server/oidc/redirect-uri";

describe("redirect uri handling", () => {
  it("classifies host wildcards", () => {
    const data = classifyRedirect("https://*.example.test/callback");
    expect(data.type).toBe(RedirectUriType.HOST_WILDCARD);
  });

  it("matches host wildcard redirects", () => {
    const normalized = resolveRedirectUri("https://app.example.test/callback", [
      { uri: "https://*.example.test/callback", type: RedirectUriType.HOST_WILDCARD, enabled: true },
    ]);
    expect(normalized).toBe("https://app.example.test/callback");
  });

  it("enforces https for non-local hosts", () => {
    expect(() =>
      resolveRedirectUri("http://example.test/callback", [
        { uri: "https://example.test/callback", type: RedirectUriType.EXACT, enabled: true },
      ]),
    ).toThrow();
  });
});
