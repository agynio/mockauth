import { randomUUID } from "crypto";

import { $Enums } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";
import { decrypt } from "@/server/crypto/key-vault";
import {
  createClient,
  deleteClient,
  getClientByIdForTenant,
  rotateClientSecret,
  updateClientTokenConfig,
  updateClientSigningAlgorithms,
} from "@/server/services/client-service";
import { describe, expect, it } from "vitest";

const createTenant = async () => {
  const tenant = await prisma.tenant.create({
    data: {
      name: `Client Test Tenant ${randomUUID()}`,
    },
  });
  const apiResource = await prisma.apiResource.create({
    data: {
      tenantId: tenant.id,
      name: "Default",
    },
  });
  await prisma.tenant.update({ where: { id: tenant.id }, data: { defaultApiResourceId: apiResource.id } });
  return tenant;
};

const createAdminUser = async () => {
  return prisma.adminUser.create({
    data: {
      email: `client-test-${randomUUID()}@example.test`,
      name: "Client Service Tester",
    },
  });
};

describe("client service", () => {
  it("creates a client with redirect URIs", async () => {
    const tenant = await createTenant();
    const { client, clientSecret } = await createClient(tenant.id, {
      name: "Admin E2E",
      tokenEndpointAuthMethods: ["client_secret_basic"],
      redirectUris: [
        "https://example.com/callback",
        "https://*.example.com/post-login",
      ],
    });

    expect(client.clientId).toMatch(/^client_/);
    expect(clientSecret).toBeDefined();

    const stored = await prisma.client.findUnique({
      where: { id: client.id },
      include: { redirectUris: true },
    });
    expect(stored?.redirectUris).toHaveLength(2);
    expect(stored?.clientSecretHash).toBeTruthy();
    expect(stored?.clientSecretEncrypted).toBeTruthy();
    expect(stored?.allowedScopes).toEqual(["openid", "profile", "email"]);
    expect(decrypt(stored?.clientSecretEncrypted as string)).toEqual(clientSecret);
  });

  it("allows configuring custom scopes", async () => {
    const tenant = await createTenant();
    const { client } = await createClient(tenant.id, {
      name: "QA Tester",
      tokenEndpointAuthMethods: ["none"],
      allowedScopes: ["openid", "tenant:write", "profile"],
    });

    const stored = await prisma.client.findUnique({ where: { id: client.id } });
    expect(stored?.allowedScopes).toEqual(["openid", "tenant:write", "profile"]);
  });

  it("rejects invalid scope formats", async () => {
    const tenant = await createTenant();
    await expect(
      createClient(tenant.id, {
        name: "Bad Scope",
        tokenEndpointAuthMethods: ["none"],
        allowedScopes: ["openid", "invalid scope"],
      }),
    ).rejects.toThrowError("Invalid scope format: invalid scope");
  });

  it("fetches a client scoped to a tenant", async () => {
    const tenant = await createTenant();
    const { client } = await createClient(tenant.id, {
      name: "SPA",
      tokenEndpointAuthMethods: ["none"],
      redirectUris: ["https://spa.test/callback"],
    });

    const fetched = await getClientByIdForTenant(tenant.id, client.id);
    expect(fetched.id).toBe(client.id);
    expect(fetched.redirectUris).toHaveLength(1);
  });

  it("rotates confidential client secrets", async () => {
    const tenant = await createTenant();
    const { client } = await createClient(tenant.id, {
      name: "Machine",
      tokenEndpointAuthMethods: ["client_secret_basic"],
    });

    const original = await prisma.client.findUnique({ where: { id: client.id } });
    const nextSecret = await rotateClientSecret(client.id);
    expect(nextSecret).toBeDefined();

    const updated = await prisma.client.findUnique({ where: { id: client.id } });
    expect(updated?.clientSecretHash).not.toEqual(original?.clientSecretHash);
    expect(updated?.clientSecretEncrypted).not.toEqual(original?.clientSecretEncrypted);
    expect(decrypt(updated?.clientSecretEncrypted as string)).toEqual(nextSecret);
  });

  it("adds secret auth methods when updating token config", async () => {
    const tenant = await createTenant();
    const { client } = await createClient(tenant.id, {
      name: "Public Client",
      tokenEndpointAuthMethods: ["none"],
    });

    const result = await updateClientTokenConfig({
      clientId: client.id,
      tokenEndpointAuthMethods: ["client_secret_basic"],
      pkceRequired: true,
      allowedGrantTypes: ["authorization_code"],
    });

    expect(result.client.tokenEndpointAuthMethods).toEqual(["client_secret_basic"]);
    expect(result.clientSecret).toBeTruthy();

    const stored = await prisma.client.findUnique({ where: { id: client.id } });
    expect(stored?.clientSecretHash).toBeTruthy();
    expect(stored?.clientSecretEncrypted).toBeTruthy();
    expect(stored?.tokenEndpointAuthMethods).toEqual(["client_secret_basic"]);
    expect(decrypt(stored?.clientSecretEncrypted as string)).toBe(result.clientSecret);
  });

  it("removes secrets when updating token config", async () => {
    const tenant = await createTenant();
    const { client } = await createClient(tenant.id, {
      name: "Confidential Client",
      tokenEndpointAuthMethods: ["client_secret_basic"],
    });

    const result = await updateClientTokenConfig({
      clientId: client.id,
      tokenEndpointAuthMethods: ["none"],
      pkceRequired: true,
      allowedGrantTypes: ["authorization_code"],
    });

    expect(result.client.tokenEndpointAuthMethods).toEqual(["none"]);
    expect(result.clientSecret).toBeNull();

    const stored = await prisma.client.findUnique({ where: { id: client.id } });
    expect(stored?.clientSecretHash).toBeNull();
    expect(stored?.clientSecretEncrypted).toBeNull();
    expect(stored?.tokenEndpointAuthMethods).toEqual(["none"]);
  });

  it("rejects empty token auth methods", async () => {
    const tenant = await createTenant();
    const { client } = await createClient(tenant.id, {
      name: "Same Type",
      tokenEndpointAuthMethods: ["client_secret_basic"],
    });

    await expect(
      updateClientTokenConfig({
        clientId: client.id,
        tokenEndpointAuthMethods: [],
        pkceRequired: true,
        allowedGrantTypes: ["authorization_code"],
      }),
    ).rejects.toThrowError("At least one token auth method is required");
  });

  it("updates signing algorithms with nullable defaults", async () => {
    const tenant = await createTenant();
    const { client } = await createClient(tenant.id, {
      name: "Alg Tester",
      tokenEndpointAuthMethods: ["none"],
    });

    await updateClientSigningAlgorithms(client.id, { idTokenAlg: "ES384", accessTokenAlg: "PS256" });

    let refreshed = await prisma.client.findUnique({ where: { id: client.id } });
    expect(refreshed?.idTokenSignedResponseAlg).toBe("ES384");
    expect(refreshed?.accessTokenSigningAlg).toBe("PS256");

    await updateClientSigningAlgorithms(client.id, { idTokenAlg: null, accessTokenAlg: null });

    refreshed = await prisma.client.findUnique({ where: { id: client.id } });
    expect(refreshed?.idTokenSignedResponseAlg).toBeNull();
    expect(refreshed?.accessTokenSigningAlg).toBeNull();
  });

  it("deletes clients and cascades dependent records", async () => {
    const tenant = await createTenant();
    const { client } = await createClient(tenant.id, {
      name: "Cascade Client",
      tokenEndpointAuthMethods: ["client_secret_basic"],
      redirectUris: ["https://cascade.example/callback"],
      oauthClientMode: "proxy",
      proxyAuthStrategy: "redirect",
      proxyConfig: {
        providerType: "oidc",
        authorizationEndpoint: "https://proxy.example/auth",
        tokenEndpoint: "https://proxy.example/token",
        upstreamClientId: "proxy-client",
      },
    });
    const apiResource = await prisma.apiResource.findFirstOrThrow({ where: { tenantId: tenant.id } });
    const admin = await createAdminUser();
    const mockUser = await prisma.mockUser.create({
      data: {
        tenantId: tenant.id,
        username: `user-${randomUUID()}`,
        displayName: "Cascade User",
      },
    });

    await prisma.oAuthTestSession.create({
      data: {
        tenantId: tenant.id,
        clientId: client.id,
        adminUserId: admin.id,
        codeVerifier: "verifier",
        redirectUri: "https://cascade.example/callback",
        scopes: "openid",
        nonce: "nonce",
        expiresAt: new Date(Date.now() + 60 * 1000),
      },
    });

    await prisma.authorizationCode.create({
      data: {
        tenantId: tenant.id,
        clientId: client.id,
        apiResourceId: apiResource.id,
        userId: mockUser.id,
        loginStrategy: $Enums.LoginStrategy.USERNAME,
        subject: mockUser.username,
        codeHash: randomUUID(),
        redirectUri: "https://cascade.example/callback",
        scope: "openid",
        codeChallenge: "challenge",
        codeChallengeMethod: "S256",
        expiresAt: new Date(Date.now() + 60 * 1000),
      },
    });

    await prisma.accessToken.create({
      data: {
        tenantId: tenant.id,
        clientId: client.id,
        apiResourceId: apiResource.id,
        userId: mockUser.id,
        jti: randomUUID(),
        scope: "openid",
        expiresAt: new Date(Date.now() + 60 * 1000),
      },
    });

    const proxyAuth = await prisma.proxyAuthTransaction.create({
      data: {
        tenantId: tenant.id,
        apiResourceId: apiResource.id,
        clientId: client.id,
        redirectUri: "https://cascade.example/callback",
        appScope: "openid",
        appCodeChallenge: "challenge",
        providerScope: "openid",
        expiresAt: new Date(Date.now() + 60 * 1000),
      },
    });

    const proxyExchange = await prisma.proxyTokenExchange.create({
      data: {
        tenantId: tenant.id,
        apiResourceId: apiResource.id,
        clientId: client.id,
        transactionId: proxyAuth.id,
        providerResponseEncrypted: "encrypted-payload",
        expiresAt: new Date(Date.now() + 60 * 1000),
      },
    });

    await prisma.proxyAuthorizationCode.create({
      data: {
        tenantId: tenant.id,
        apiResourceId: apiResource.id,
        clientId: client.id,
        codeHash: randomUUID(),
        redirectUri: "https://cascade.example/callback",
        scope: "openid",
        codeChallenge: "challenge",
        codeChallengeMethod: "S256",
        expiresAt: new Date(Date.now() + 60 * 1000),
        tokenExchangeId: proxyExchange.id,
      },
    });

    const auditLog = await prisma.auditLog.create({
      data: {
        tenantId: tenant.id,
        clientId: client.id,
        actorId: admin.id,
        eventType: $Enums.AuditLogEventType.CONFIG_CHANGED,
        severity: $Enums.AuditLogSeverity.INFO,
        message: "Client updated",
      },
    });

    await deleteClient(client.id);

    const retainedLog = await prisma.auditLog.findUnique({ where: { id: auditLog.id } });
    expect(await prisma.client.findUnique({ where: { id: client.id } })).toBeNull();
    expect(retainedLog).not.toBeNull();
    expect(retainedLog?.clientId).toBeNull();
    expect(await prisma.redirectUri.count({ where: { clientId: client.id } })).toBe(0);
    expect(await prisma.oAuthTestSession.count({ where: { clientId: client.id } })).toBe(0);
    expect(await prisma.authorizationCode.count({ where: { clientId: client.id } })).toBe(0);
    expect(await prisma.accessToken.count({ where: { clientId: client.id } })).toBe(0);
    expect(await prisma.proxyProviderConfig.count({ where: { clientId: client.id } })).toBe(0);
    expect(await prisma.proxyAuthTransaction.count({ where: { clientId: client.id } })).toBe(0);
    expect(await prisma.proxyTokenExchange.count({ where: { clientId: client.id } })).toBe(0);
    expect(await prisma.proxyAuthorizationCode.count({ where: { clientId: client.id } })).toBe(0);
  });

  it("throws when deleting unknown clients", async () => {
    await expect(deleteClient("missing-client")).rejects.toThrowError("Client not found");
  });
});
