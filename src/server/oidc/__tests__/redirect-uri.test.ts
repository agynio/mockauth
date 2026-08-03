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

  it("classifies port wildcards", () => {
    const data = classifyRedirect("http://localhost:*/callback");
    expect(data.type).toBe(RedirectUriType.EXACT);
    expect(data.normalized).toBe("http://localhost:*/callback");
  });

  it("matches any port for port wildcard redirects", () => {
    const classified = classifyRedirect("http://localhost:*/callback");
    const record = { uri: classified.normalized, type: classified.type, enabled: true };

    expect(resolveRedirectUri("http://localhost:53682/callback", [record])).toBe(
      "http://localhost:53682/callback",
    );
    expect(resolveRedirectUri("http://localhost/callback", [record])).toBe("http://localhost/callback");
    expect(() => resolveRedirectUri("http://localhost:53682/other", [record])).toThrow("redirect_uri mismatch");
    expect(() => resolveRedirectUri("http://127.0.0.1:53682/callback", [record])).toThrow("redirect_uri mismatch");
  });

  it("keeps enforcing the scheme rules for port wildcards", () => {
    expect(() => classifyRedirect("http://app.example.test:*/callback")).toThrow("must use https");

    const classified = classifyRedirect("https://app.example.test:*/callback");
    expect(classified.normalized).toBe("https://app.example.test:*/callback");
    expect(resolveRedirectUri("https://app.example.test:8443/callback", [
      { uri: classified.normalized, type: classified.type, enabled: true },
    ])).toBe("https://app.example.test:8443/callback");
  });

  it("combines port wildcards with path wildcards", () => {
    const classified = classifyRedirect("http://127.0.0.1:*/callback/*");
    expect(classified.type).toBe(RedirectUriType.PATH_SUFFIX);
    expect(classified.normalized).toBe("http://127.0.0.1:*/callback/*");

    const record = { uri: classified.normalized, type: classified.type, enabled: true };
    expect(resolveRedirectUri("http://127.0.0.1:4111/callback/child", [record])).toBe(
      "http://127.0.0.1:4111/callback/child",
    );
    expect(() => resolveRedirectUri("http://127.0.0.1:4111/other", [record])).toThrow("redirect_uri mismatch");
  });

  it("combines port wildcards with host wildcards", () => {
    const classified = classifyRedirect("https://*.example.test:*/callback");
    expect(classified.type).toBe(RedirectUriType.HOST_WILDCARD);
    expect(classified.normalized).toBe("https://*.example.test:*/callback");

    const record = { uri: classified.normalized, type: classified.type, enabled: true };
    expect(resolveRedirectUri("https://app.example.test:8443/callback", [record])).toBe(
      "https://app.example.test:8443/callback",
    );
    expect(resolveRedirectUri("https://app.example.test/callback", [record])).toBe(
      "https://app.example.test/callback",
    );
  });

  it("supports explicit ports on host wildcards", () => {
    const classified = classifyRedirect("https://*.example.test:8443/callback");
    expect(classified.normalized).toBe("https://*.example.test:8443/callback");

    const record = { uri: classified.normalized, type: classified.type, enabled: true };
    expect(resolveRedirectUri("https://app.example.test:8443/callback", [record])).toBe(
      "https://app.example.test:8443/callback",
    );
    expect(() => resolveRedirectUri("https://app.example.test:9443/callback", [record])).toThrow(
      "redirect_uri mismatch",
    );
    expect(() => resolveRedirectUri("https://app.example.test/callback", [record])).toThrow("redirect_uri mismatch");
  });

  it("drops the https default port when normalizing host wildcards", () => {
    expect(classifyRedirect("https://*.example.test:443/callback").normalized).toBe(
      "https://*.example.test/callback",
    );
  });

  it("requires the default port when a host wildcard omits one", () => {
    expect(() =>
      resolveRedirectUri("https://app.example.test:8443/callback", [
        { uri: "https://*.example.test/callback", type: RedirectUriType.HOST_WILDCARD, enabled: true },
      ]),
    ).toThrow("redirect_uri mismatch");
  });

  it("keeps enforcing ports for entries without a port wildcard", () => {
    expect(() =>
      resolveRedirectUri("http://localhost:53682/callback", [
        { uri: "http://localhost:3000/callback", type: RedirectUriType.EXACT, enabled: true },
      ]),
    ).toThrow("redirect_uri mismatch");
  });

  it("supports port wildcards on the IPv6 loopback", () => {
    const classified = classifyRedirect("http://[::1]:*/callback");
    expect(classified.normalized).toBe("http://[::1]:*/callback");
    expect(
      resolveRedirectUri("http://[::1]:53682/callback", [
        { uri: classified.normalized, type: classified.type, enabled: true },
      ]),
    ).toBe("http://[::1]:53682/callback");
  });

  it("keeps query strings on port wildcard entries", () => {
    const classified = classifyRedirect("https://app.example.test:*/callback?flow=qa");
    expect(classified.normalized).toBe("https://app.example.test:*/callback?flow=qa");

    const record = { uri: classified.normalized, type: classified.type, enabled: true };
    expect(resolveRedirectUri("https://app.example.test:8443/callback?flow=qa", [record])).toBe(
      "https://app.example.test:8443/callback?flow=qa",
    );
    expect(() => resolveRedirectUri("https://app.example.test:8443/callback", [record])).toThrow(
      "redirect_uri mismatch",
    );
  });

  it("does not treat credentials as a port wildcard", () => {
    const classified = classifyRedirect("https://user:*@example.test/callback");
    expect(classified.normalized).toBe("https://example.test/callback");

    expect(() =>
      resolveRedirectUri("https://example.test:8443/callback", [
        { uri: classified.normalized, type: classified.type, enabled: true },
      ]),
    ).toThrow("redirect_uri mismatch");
  });

  it("rejects wildcards in the requested redirect_uri", () => {
    expectInvalidRedirectUri("http://localhost:*/callback", () =>
      resolveRedirectUri("http://localhost:*/callback", [
        { uri: "http://localhost:*/callback", type: RedirectUriType.EXACT, enabled: true },
      ]),
    );
  });

  it("rejects out-of-range ports on host wildcards", () => {
    expect(() => classifyRedirect("https://*.example.test:99999/callback")).toThrow("invalid port");
    expect(() => classifyRedirect("https://*.example.test:0/callback")).toThrow("invalid port");
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
