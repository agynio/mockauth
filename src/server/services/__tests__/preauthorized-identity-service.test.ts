import { randomUUID } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/server/db/client";
import { decrypt, encrypt } from "@/server/crypto/key-vault";
import { createClient } from "@/server/services/client-service";
import {
  createPreauthorizedIdentity,
  refreshPreauthorizedIdentity,
  resolvePreauthorizedIdentityTokens,
} from "@/server/services/preauthorized-identity-service";

const buildIdToken = (payload: Record<string, unknown>) => {
  const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.signature`;
};

const createTenant = async () => {
  return prisma.tenant.create({
    data: { name: `Preauth Tenant ${randomUUID()}` },
  });
};

const createPreauthorizedClient = async (tenantId: string) => {
  return createClient(tenantId, {
    name: "Preauth Client",
    tokenEndpointAuthMethods: ["client_secret_basic"],
    oauthClientMode: "proxy",
    proxyAuthStrategy: "preauthorized",
    proxyConfig: {
      providerType: "oidc",
      authorizationEndpoint: "https://provider.example/authorize",
      tokenEndpoint: "https://provider.example/token",
      upstreamClientId: "upstream-client",
      upstreamClientSecret: "super-secret",
    },
  });
};

describe("preauthorized identity creation", () => {
  it("uses provider metadata for labels and encrypts payloads", async () => {
    const tenant = await createTenant();
    const { client } = await createPreauthorizedClient(tenant.id);

    const providerResponse = {
      access_token: "access-token",
      refresh_token: "refresh-token",
      id_token: buildIdToken({ sub: "user-1", email: "user@example.test" }),
      expires_in: 3600,
    };

    const identity = await createPreauthorizedIdentity({
      tenantId: tenant.id,
      clientId: client.id,
      label: " ",
      providerScope: "openid email",
      providerResponse,
    });

    const stored = await prisma.preauthorizedIdentity.findUnique({ where: { id: identity.id } });
    expect(stored?.label).toBe("user@example.test");
    expect(stored?.providerSubject).toBe("user-1");
    expect(stored?.providerEmail).toBe("user@example.test");
    expect(stored?.providerScope).toBe("openid email");
    const rawPayload = JSON.stringify(providerResponse);
    expect(stored?.providerResponseEncrypted).not.toBe(rawPayload);
    expect(decrypt(stored?.providerResponseEncrypted as string)).toBe(rawPayload);
  });

  it("rejects provider responses without a subject", async () => {
    const tenant = await createTenant();
    const { client } = await createPreauthorizedClient(tenant.id);

    await expect(
      createPreauthorizedIdentity({
        tenantId: tenant.id,
        clientId: client.id,
        providerScope: "openid",
        providerResponse: { access_token: "access-token", expires_in: 3600 },
      }),
    ).rejects.toThrow("Provider id_token subject missing");
  });
});

describe("preauthorized identity refresh", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("refreshes provider tokens and updates metadata", async () => {
    const tenant = await createTenant();
    const { client } = await createPreauthorizedClient(tenant.id);

    const initialPayload = {
      access_token: "old-access",
      refresh_token: "refresh-token",
      id_token: buildIdToken({ sub: "user-1", email: "old@example.test" }),
      expires_in: 10,
    };

    const identity = await prisma.preauthorizedIdentity.create({
      data: {
        tenantId: tenant.id,
        clientId: client.id,
        label: "QA user",
        providerSubject: "user-1",
        providerEmail: "old@example.test",
        providerScope: "openid email",
        providerResponseEncrypted: encrypt(JSON.stringify(initialPayload)),
        accessTokenExpiresAt: new Date(Date.now() - 1000),
        refreshTokenExpiresAt: null,
      },
    });

    const refreshedPayload = {
      access_token: "new-access",
      refresh_token: "new-refresh",
      id_token: buildIdToken({ sub: "user-1", email: "new@example.test" }),
      expires_in: 3600,
    };

    const fetchMock = vi
      .spyOn(global, "fetch")
      .mockResolvedValue(new Response(JSON.stringify(refreshedPayload), { status: 200 }));

    const result = await refreshPreauthorizedIdentity({
      tenantId: tenant.id,
      clientId: client.id,
      identityId: identity.id,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.providerResponse.access_token).toBe("new-access");

    const stored = await prisma.preauthorizedIdentity.findUnique({ where: { id: identity.id } });
    expect(stored?.providerEmail).toBe("new@example.test");
    expect(stored?.providerSubject).toBe("user-1");
    expect(stored?.accessTokenExpiresAt).toBeInstanceOf(Date);
  });

  it("preserves refresh token when provider omits it", async () => {
    const tenant = await createTenant();
    const { client } = await createPreauthorizedClient(tenant.id);

    const initialPayload = {
      access_token: "old-access",
      refresh_token: "refresh-token",
      expires_in: 10,
    };

    const identity = await prisma.preauthorizedIdentity.create({
      data: {
        tenantId: tenant.id,
        clientId: client.id,
        label: "QA user",
        providerSubject: "user-1",
        providerEmail: null,
        providerScope: "openid email",
        providerResponseEncrypted: encrypt(JSON.stringify(initialPayload)),
        accessTokenExpiresAt: new Date(Date.now() - 1000),
        refreshTokenExpiresAt: null,
      },
    });

    const refreshedPayload = {
      access_token: "new-access",
      expires_in: 3600,
    };

    vi.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify(refreshedPayload), { status: 200 }));

    const result = await refreshPreauthorizedIdentity({
      tenantId: tenant.id,
      clientId: client.id,
      identityId: identity.id,
    });

    expect(result.providerResponse.refresh_token).toBe("refresh-token");
    expect(result.identity.providerSubject).toBe("user-1");
  });

  it("rejects refreshes without a stored refresh token", async () => {
    const tenant = await createTenant();
    const { client } = await createPreauthorizedClient(tenant.id);

    const identity = await prisma.preauthorizedIdentity.create({
      data: {
        tenantId: tenant.id,
        clientId: client.id,
        label: "QA user",
        providerSubject: "user-1",
        providerEmail: null,
        providerScope: "openid email",
        providerResponseEncrypted: encrypt(JSON.stringify({ access_token: "old-access" })),
        accessTokenExpiresAt: new Date(Date.now() - 1000),
        refreshTokenExpiresAt: null,
      },
    });

    await expect(
      refreshPreauthorizedIdentity({
        tenantId: tenant.id,
        clientId: client.id,
        identityId: identity.id,
      }),
    ).rejects.toThrow("Refresh token missing for preauthorized identity");
  });

  it("rejects refreshes when provider response is not ok", async () => {
    const tenant = await createTenant();
    const { client } = await createPreauthorizedClient(tenant.id);

    const identity = await prisma.preauthorizedIdentity.create({
      data: {
        tenantId: tenant.id,
        clientId: client.id,
        label: "QA user",
        providerSubject: "user-1",
        providerEmail: null,
        providerScope: "openid email",
        providerResponseEncrypted: encrypt(JSON.stringify({
          access_token: "old-access",
          refresh_token: "refresh-token",
        })),
        accessTokenExpiresAt: new Date(Date.now() - 1000),
        refreshTokenExpiresAt: null,
      },
    });

    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "invalid_grant", error_description: "Invalid refresh" }), {
        status: 400,
      }),
    );

    await expect(
      refreshPreauthorizedIdentity({
        tenantId: tenant.id,
        clientId: client.id,
        identityId: identity.id,
      }),
    ).rejects.toThrow("Invalid refresh");
  });

  it("rejects refreshes with non-JSON responses", async () => {
    const tenant = await createTenant();
    const { client } = await createPreauthorizedClient(tenant.id);

    const identity = await prisma.preauthorizedIdentity.create({
      data: {
        tenantId: tenant.id,
        clientId: client.id,
        label: "QA user",
        providerSubject: "user-1",
        providerEmail: null,
        providerScope: "openid email",
        providerResponseEncrypted: encrypt(JSON.stringify({
          access_token: "old-access",
          refresh_token: "refresh-token",
        })),
        accessTokenExpiresAt: new Date(Date.now() - 1000),
        refreshTokenExpiresAt: null,
      },
    });

    vi.spyOn(global, "fetch").mockResolvedValue(new Response("not-json", { status: 200 }));

    await expect(
      refreshPreauthorizedIdentity({
        tenantId: tenant.id,
        clientId: client.id,
        identityId: identity.id,
      }),
    ).rejects.toThrow("Provider token response was not JSON");
  });
});

describe("resolve preauthorized identity tokens", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns stored tokens when refresh is not needed", async () => {
    const tenant = await createTenant();
    const { client } = await createPreauthorizedClient(tenant.id);
    const now = new Date("2024-05-01T00:00:00Z");

    const providerResponse = {
      access_token: "stored-access",
      refresh_token: "stored-refresh",
      id_token: buildIdToken({ sub: "user-1" }),
      expires_in: 3600,
    };

    const identity = await prisma.preauthorizedIdentity.create({
      data: {
        tenantId: tenant.id,
        clientId: client.id,
        label: "QA user",
        providerSubject: "user-1",
        providerEmail: null,
        providerScope: "openid",
        providerResponseEncrypted: encrypt(JSON.stringify(providerResponse)),
        accessTokenExpiresAt: new Date(now.getTime() + 5 * 60 * 1000),
        refreshTokenExpiresAt: null,
      },
    });

    const fetchSpy = vi.spyOn(global, "fetch");

    const result = await resolvePreauthorizedIdentityTokens({
      tenantId: tenant.id,
      clientId: client.id,
      identityId: identity.id,
      now,
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.providerResponse.access_token).toBe("stored-access");
  });

  it("refreshes tokens when expiry is within the buffer", async () => {
    const tenant = await createTenant();
    const { client } = await createPreauthorizedClient(tenant.id);
    const now = new Date("2024-05-01T00:00:00Z");

    const providerResponse = {
      access_token: "stored-access",
      refresh_token: "stored-refresh",
      id_token: buildIdToken({ sub: "user-1" }),
      expires_in: 3600,
    };

    const identity = await prisma.preauthorizedIdentity.create({
      data: {
        tenantId: tenant.id,
        clientId: client.id,
        label: "QA user",
        providerSubject: "user-1",
        providerEmail: null,
        providerScope: "openid",
        providerResponseEncrypted: encrypt(JSON.stringify(providerResponse)),
        accessTokenExpiresAt: new Date(now.getTime() + 30 * 1000),
        refreshTokenExpiresAt: null,
      },
    });

    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: "refreshed-access",
          refresh_token: "refreshed-refresh",
          id_token: buildIdToken({ sub: "user-1", email: "new@example.test" }),
          expires_in: 3600,
        }),
        { status: 200 },
      ),
    );

    const result = await resolvePreauthorizedIdentityTokens({
      tenantId: tenant.id,
      clientId: client.id,
      identityId: identity.id,
      now,
    });

    expect(result.providerResponse.access_token).toBe("refreshed-access");
    expect(result.identity.providerEmail).toBe("new@example.test");
  });
});
