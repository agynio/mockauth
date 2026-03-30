import { randomUUID } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/server/db/client";
import { encrypt } from "@/server/crypto/key-vault";
import { createClient } from "@/server/services/client-service";
import { refreshPreauthorizedIdentity } from "@/server/services/preauthorized-identity-service";

const buildIdToken = (payload: Record<string, unknown>) => {
  const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.signature`;
};

describe("preauthorized identity refresh", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("refreshes provider tokens and updates metadata", async () => {
    const tenant = await prisma.tenant.create({
      data: { name: `Preauth Tenant ${randomUUID()}` },
    });

    const { client } = await createClient(tenant.id, {
      name: "Preauth Client",
      tokenEndpointAuthMethods: ["client_secret_basic"],
      oauthClientMode: "preauthorized",
      proxyConfig: {
        providerType: "oidc",
        authorizationEndpoint: "https://provider.example/authorize",
        tokenEndpoint: "https://provider.example/token",
        upstreamClientId: "upstream-client",
        upstreamClientSecret: "super-secret",
      },
    });

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
    const tenant = await prisma.tenant.create({
      data: { name: `Preauth Tenant ${randomUUID()}` },
    });

    const { client } = await createClient(tenant.id, {
      name: "Preauth Client",
      tokenEndpointAuthMethods: ["client_secret_basic"],
      oauthClientMode: "preauthorized",
      proxyConfig: {
        providerType: "oidc",
        authorizationEndpoint: "https://provider.example/authorize",
        tokenEndpoint: "https://provider.example/token",
        upstreamClientId: "upstream-client",
        upstreamClientSecret: "super-secret",
      },
    });

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
  });
});
