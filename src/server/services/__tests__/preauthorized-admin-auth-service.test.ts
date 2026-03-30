import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { prisma } from "@/server/db/client";
import { createClient } from "@/server/services/client-service";
import { completePreauthorizedAdminAuth } from "@/server/services/preauthorized-admin-auth-service";

const createTenant = async () => {
  return prisma.tenant.create({
    data: { name: `Preauth Admin ${randomUUID()}` },
  });
};

const createAdminUser = async () => {
  return prisma.adminUser.create({
    data: {
      email: `admin-${randomUUID()}@example.test`,
      name: "Admin Auth Tester",
    },
  });
};

const createPreauthorizedClient = async (tenantId: string) => {
  return createClient(tenantId, {
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
};

const createBarePreauthorizedClient = async (tenantId: string) => {
  return prisma.client.create({
    data: {
      tenantId,
      name: "Bare Preauth Client",
      clientId: `client_${randomUUID()}`,
      oauthClientMode: "preauthorized",
    },
  });
};

const createTransaction = async (input: {
  tenantId: string;
  clientId: string;
  adminUserId: string;
  expiresAt: Date;
}) => {
  return prisma.adminAuthTransaction.create({
    data: {
      tenantId: input.tenantId,
      clientId: input.clientId,
      adminUserId: input.adminUserId,
      redirectUri: "https://mockauth.test/callback",
      providerScope: "openid",
      providerPkceEnabled: false,
      identityLabel: null,
      expiresAt: input.expiresAt,
    },
  });
};

const buildCallbackArgs = (input: {
  tenantId: string;
  clientId: string;
  adminUserId: string;
  state: string;
  transactionCookie: string | null;
}) => ({
  tenantId: input.tenantId,
  clientId: input.clientId,
  adminUserId: input.adminUserId,
  state: input.state,
  code: "provider-code",
  providerError: null,
  providerErrorDescription: null,
  transactionCookie: input.transactionCookie,
  callbackRequest: {
    url: "https://mockauth.test/callback",
    headers: {},
    contentType: null,
    body: null,
  },
  callbackParams: {},
  requestContext: undefined,
});

describe("preauthorized admin auth", () => {
  it("records security violations for state mismatches", async () => {
    const tenant = await createTenant();
    const admin = await createAdminUser();
    const { client } = await createPreauthorizedClient(tenant.id);
    const transaction = await createTransaction({
      tenantId: tenant.id,
      clientId: client.id,
      adminUserId: admin.id,
      expiresAt: new Date(Date.now() + 60 * 1000),
    });

    await expect(
      completePreauthorizedAdminAuth(
        buildCallbackArgs({
          tenantId: tenant.id,
          clientId: client.id,
          adminUserId: admin.id,
          state: transaction.id,
          transactionCookie: "invalid",
        }),
      ),
    ).rejects.toThrow("Invalid or missing admin transaction");

    const stored = await prisma.adminAuthTransaction.findUnique({ where: { id: transaction.id } });
    expect(stored).not.toBeNull();

    const audit = await prisma.auditLog.findFirst({
      where: { eventType: "SECURITY_VIOLATION", traceId: transaction.id },
    });
    expect(audit).not.toBeNull();
  });

  it("deletes expired transactions", async () => {
    const tenant = await createTenant();
    const admin = await createAdminUser();
    const { client } = await createPreauthorizedClient(tenant.id);
    const transaction = await createTransaction({
      tenantId: tenant.id,
      clientId: client.id,
      adminUserId: admin.id,
      expiresAt: new Date(Date.now() - 60 * 1000),
    });

    await expect(
      completePreauthorizedAdminAuth(
        buildCallbackArgs({
          tenantId: tenant.id,
          clientId: client.id,
          adminUserId: admin.id,
          state: transaction.id,
          transactionCookie: transaction.id,
        }),
      ),
    ).rejects.toThrow("Admin transaction expired");

    const stored = await prisma.adminAuthTransaction.findUnique({ where: { id: transaction.id } });
    expect(stored).toBeNull();
  });

  it("deletes transactions when proxy config is missing", async () => {
    const tenant = await createTenant();
    const admin = await createAdminUser();
    const client = await createBarePreauthorizedClient(tenant.id);
    const transaction = await createTransaction({
      tenantId: tenant.id,
      clientId: client.id,
      adminUserId: admin.id,
      expiresAt: new Date(Date.now() + 60 * 1000),
    });

    await expect(
      completePreauthorizedAdminAuth(
        buildCallbackArgs({
          tenantId: tenant.id,
          clientId: client.id,
          adminUserId: admin.id,
          state: transaction.id,
          transactionCookie: transaction.id,
        }),
      ),
    ).rejects.toThrow("Proxy configuration missing");

    const stored = await prisma.adminAuthTransaction.findUnique({ where: { id: transaction.id } });
    expect(stored).toBeNull();
  });
});
