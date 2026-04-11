import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetApiResourceWithTenant = vi.hoisted(() => vi.fn());
const mockGetClientForTenant = vi.hoisted(() => vi.fn());
const mockResolveRedirectUri = vi.hoisted(() => vi.fn());
const mockClearSession = vi.hoisted(() => vi.fn());

vi.mock("@/server/services/api-resource-service", () => ({
  getApiResourceWithTenant: mockGetApiResourceWithTenant,
}));

vi.mock("@/server/services/client-service", () => ({
  getClientForTenant: mockGetClientForTenant,
}));

vi.mock("@/server/oidc/redirect-uri", () => ({
  resolveRedirectUri: mockResolveRedirectUri,
}));

vi.mock("@/server/services/mock-session-service", () => ({
  clearSession: mockClearSession,
}));

import { handleEndSession } from "@/server/services/end-session-service";

const ORIGIN = "https://mockauth.test";
const API_RESOURCE_ID = "resource_123";
const ISSUER = `${ORIGIN}/r/${API_RESOURCE_ID}/oidc`;
const TENANT_ID = "tenant_123";
const REDIRECT_URI = "https://client.example/logout";
const REDIRECT_URIS = [{ uri: REDIRECT_URI }];

const buildIdToken = (payload: Record<string, unknown>) => {
  const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${encodedPayload}.signature`;
};

describe("handleEndSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetApiResourceWithTenant.mockResolvedValue({
      tenant: { id: TENANT_ID },
      resource: { id: API_RESOURCE_ID },
    } as never);
    mockGetClientForTenant.mockResolvedValue({ redirectUris: REDIRECT_URIS } as never);
    mockResolveRedirectUri.mockReturnValue(REDIRECT_URI);
    mockClearSession.mockResolvedValue(undefined);
  });

  it("redirects when id_token_hint matches issuer", async () => {
    const idTokenHint = buildIdToken({ iss: ISSUER, aud: "client_123" });

    const result = await handleEndSession(
      {
        apiResourceId: API_RESOURCE_ID,
        idTokenHint,
        clientId: "client_123",
        postLogoutRedirectUri: REDIRECT_URI,
        state: "state-1",
      },
      ORIGIN,
    );

    expect(result.type).toBe("redirect");
    if (result.type === "redirect") {
      expect(result.redirectTo).toBe(`${REDIRECT_URI}?state=state-1`);
    }
    expect(result.clearSessionCookie).toBe(false);
    expect(mockGetClientForTenant).toHaveBeenCalledWith(TENANT_ID, "client_123");
    expect(mockResolveRedirectUri).toHaveBeenCalledWith(REDIRECT_URI, REDIRECT_URIS);
    expect(mockClearSession).not.toHaveBeenCalled();
  });

  it("returns HTML when no id_token_hint or redirect", async () => {
    const result = await handleEndSession({ apiResourceId: API_RESOURCE_ID }, ORIGIN);

    expect(result.type).toBe("html");
    if (result.type === "html") {
      expect(result.html).toContain("You have been logged out.");
    }
    expect(result.clearSessionCookie).toBe(false);
    expect(mockGetClientForTenant).not.toHaveBeenCalled();
    expect(mockResolveRedirectUri).not.toHaveBeenCalled();
    expect(mockClearSession).not.toHaveBeenCalled();
  });

  it("rejects id_token_hint with mismatched issuer", async () => {
    const idTokenHint = buildIdToken({ iss: "https://issuer.example", aud: "client_123" });

    await expect(
      handleEndSession(
        {
          apiResourceId: API_RESOURCE_ID,
          idTokenHint,
        },
        ORIGIN,
      ),
    ).rejects.toThrow("id_token_hint issuer mismatch");
  });

  it("rejects when client_id is not in aud", async () => {
    const idTokenHint = buildIdToken({ iss: ISSUER, aud: ["client_a"] });

    await expect(
      handleEndSession(
        {
          apiResourceId: API_RESOURCE_ID,
          idTokenHint,
          clientId: "client_b",
        },
        ORIGIN,
      ),
    ).rejects.toThrow("client_id does not match id_token_hint");
  });

  it("falls back to HTML when post_logout_redirect_uri has no client", async () => {
    const result = await handleEndSession(
      {
        apiResourceId: API_RESOURCE_ID,
        postLogoutRedirectUri: REDIRECT_URI,
      },
      ORIGIN,
    );

    expect(result.type).toBe("html");
    expect(result.clearSessionCookie).toBe(false);
    expect(mockGetClientForTenant).not.toHaveBeenCalled();
    expect(mockResolveRedirectUri).not.toHaveBeenCalled();
  });

  it("clears session when a session token is present", async () => {
    const result = await handleEndSession(
      {
        apiResourceId: API_RESOURCE_ID,
        sessionToken: "session-1",
      },
      ORIGIN,
    );

    expect(result.type).toBe("html");
    expect(result.clearSessionCookie).toBe(true);
    expect(mockClearSession).toHaveBeenCalledWith(TENANT_ID, "session-1");
  });

  it("rejects malformed JWT payloads", async () => {
    const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
    const badPayload = Buffer.from("not-json").toString("base64url");
    const idTokenHint = `${header}.${badPayload}.sig`;

    await expect(
      handleEndSession(
        {
          apiResourceId: API_RESOURCE_ID,
          idTokenHint,
        },
        ORIGIN,
      ),
    ).rejects.toThrow("id_token_hint payload is invalid");
  });
});
