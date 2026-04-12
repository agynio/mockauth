import { randomUUID } from "crypto";

import { describe, expect, it } from "vitest";

import { $Enums } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";
import { createClient } from "@/server/services/client-service";
import { createTenant, deleteTenant } from "@/server/services/tenant-service";

const createAdminUser = async () => {
  return prisma.adminUser.create({
    data: {
      email: `tenant-test-${randomUUID()}@example.test`,
      name: "Tenant Service Tester",
    },
  });
};

describe("tenant service", () => {
  it("removes tenants and all dependent records", async () => {
    const admin = await createAdminUser();
    const tenant = await createTenant(admin.id, { name: `Tenant Cascade ${randomUUID()}` });
    const { client } = await createClient(tenant.id, {
      name: "Cascade Client",
      tokenEndpointAuthMethods: ["client_secret_basic"],
      redirectUris: ["https://cascade.example/callback"],
    });
    const apiResource = await prisma.apiResource.findFirstOrThrow({ where: { tenantId: tenant.id } });
    const mockUser = await prisma.mockUser.create({
      data: {
        tenantId: tenant.id,
        username: `user-${randomUUID()}`,
        displayName: "Cascade User",
      },
    });
    await prisma.mockSession.create({
      data: {
        tenantId: tenant.id,
        userId: mockUser.id,
        loginStrategy: $Enums.LoginStrategy.USERNAME,
        subject: mockUser.username,
        sessionTokenHash: randomUUID(),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });
    await prisma.mockIdentity.create({
      data: {
        tenantId: tenant.id,
        strategy: $Enums.LoginStrategy.USERNAME,
        identifier: `identity-${randomUUID()}`,
        sub: randomUUID(),
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
    await prisma.refreshToken.create({
      data: {
        tenantId: tenant.id,
        clientId: client.id,
        apiResourceId: apiResource.id,
        userId: mockUser.id,
        loginStrategy: $Enums.LoginStrategy.USERNAME,
        subject: mockUser.username,
        familyId: randomUUID(),
        tokenHash: randomUUID(),
        scope: "openid",
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });
    await prisma.invite.create({
      data: {
        tenantId: tenant.id,
        role: "READER",
        tokenHash: randomUUID(),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        createdByUserId: admin.id,
      },
    });

    await deleteTenant(tenant.id);

    expect(await prisma.tenant.findUnique({ where: { id: tenant.id } })).toBeNull();
    expect(await prisma.client.count({ where: { tenantId: tenant.id } })).toBe(0);
    expect(await prisma.apiResource.count({ where: { tenantId: tenant.id } })).toBe(0);
    expect(await prisma.redirectUri.count({ where: { client: { tenantId: tenant.id } } })).toBe(0);
    expect(await prisma.tenantKey.count({ where: { tenantId: tenant.id } })).toBe(0);
    expect(await prisma.tenantMembership.count({ where: { tenantId: tenant.id } })).toBe(0);
    expect(await prisma.invite.count({ where: { tenantId: tenant.id } })).toBe(0);
    expect(await prisma.authorizationCode.count({ where: { tenantId: tenant.id } })).toBe(0);
    expect(await prisma.accessToken.count({ where: { tenantId: tenant.id } })).toBe(0);
    expect(await prisma.refreshToken.count({ where: { tenantId: tenant.id } })).toBe(0);
    expect(await prisma.mockUser.count({ where: { tenantId: tenant.id } })).toBe(0);
    expect(await prisma.mockSession.count({ where: { tenantId: tenant.id } })).toBe(0);
    expect(await prisma.mockIdentity.count({ where: { tenantId: tenant.id } })).toBe(0);
  });
});
