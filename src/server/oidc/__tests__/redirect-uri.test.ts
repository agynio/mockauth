import { RedirectUriType } from "@/generated/prisma/client";
import { DomainError } from "@/server/errors";
import { setAllowAnyRedirectOverride } from "@/server/oidc/redirect-policy";
import { classifyRedirect, resolveRedirectUri } from "@/server/oidc/redirect-uri";

afterEach(() => {
  setAllowAnyRedirectOverride(null);
});

const expectInvalidRedirectUri = (value: string, action: () => void) => {
  expect(action).toThrow(DomainError);
  try {
    action();
  } catch (error) {
    expect(error).toMatchObject({
      message: `redirect_uri is not a valid URL: ${value}`,
      options: { status: 400, code: "invalid_redirect_uri" },
    });
  }
};

describe("redirect uri handling", () => {
  it("classifies host wildcards", () => {
    const data = classifyRedirect("https://*.example.test/callback");
    expect(data.type).toBe(RedirectUriType.HOST_WILDCARD);
    expect(data.normalized).toBe("https://*.example.test/callback");
  });

  it("preserves path casing for host wildcard redirects", () => {
    const data = classifyRedirect("https://*.Example.test/CamelCase");
    expect(data.normalized).toBe("https://*.example.test/CamelCase");

    const normalized = resolveRedirectUri("https://app.example.test/CamelCase", [
      { uri: data.normalized, type: RedirectUriType.HOST_WILDCARD, enabled: true },
    ]);
    expect(normalized).toBe("https://app.example.test/CamelCase");
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

  it("supports path wildcard prefixes", () => {
    const classified = classifyRedirect("https://app.example.test/callback/*");
    expect(classified.type).toBe(RedirectUriType.PATH_SUFFIX);
    const normalized = resolveRedirectUri("https://app.example.test/callback/child", [
      { uri: classified.normalized, type: RedirectUriType.PATH_SUFFIX, enabled: true },
    ]);
    expect(normalized).toBe("https://app.example.test/callback/child");
  });

  it("rejects host + path wildcard combos", () => {
    expect(() => classifyRedirect("https://*.example.test/callback/*")).toThrow("Host wildcards");
  });

  it("rejects fragments in redirect entries", () => {
    expect(() => classifyRedirect("https://example.test/callback#frag")).toThrow("fragment");
  });

  it("throws for invalid resolveRedirectUri inputs", () => {
    expectInvalidRedirectUri("${E2E_OIDC_REDIRECT_URI}", () =>
      resolveRedirectUri("${E2E_OIDC_REDIRECT_URI}", []),
    );
    expectInvalidRedirectUri("not-a-url", () => resolveRedirectUri("not-a-url", []));
  });

  it("throws for whitespace-only redirect_uri", () => {
    expectInvalidRedirectUri("   ", () => resolveRedirectUri("   ", []));
  });

  it("throws for invalid classifyRedirect inputs", () => {
    expectInvalidRedirectUri("not-a-url", () => classifyRedirect("not-a-url"));
  });

  it("throws for invalid path wildcard bases", () => {
    expectInvalidRedirectUri("not-a-url/", () => classifyRedirect("not-a-url/*"));
  });

  it("gates * redirects behind the env flag", () => {
    const classified = classifyRedirect("*");
    expect(classified.type).toBe(RedirectUriType.ANY);
    expect(classified.normalized).toBe("*");

    expect(() =>
      resolveRedirectUri("https://example.test/callback", [
        { uri: classified.normalized, type: RedirectUriType.ANY, enabled: true },
      ]),
    ).toThrow("redirect_uri mismatch");

    setAllowAnyRedirectOverride(true);
    const normalized = resolveRedirectUri("https://example.test/any", [
      { uri: classified.normalized, type: RedirectUriType.ANY, enabled: true },
    ]);
    expect(normalized).toBe("https://example.test/any");
  });
});
