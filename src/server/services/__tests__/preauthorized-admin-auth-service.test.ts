import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { prisma } from "@/server/db/client";
import { DEFAULT_PROXY_AUTH_STRATEGIES } from "@/server/oidc/proxy-auth-strategy";
import { createClient } from "@/server/services/client-service";
import { completePreauthorizedAdminAuth } from "@/server/services/preauthorized-admin-auth-service";

const createTenant = async () => {
  const tenant = await prisma.tenant.create({
    data: { name: `Preauth Admin ${randomUUID()}` },
  });
  const apiResource = await prisma.apiResource.create({
    data: {
      tenantId: tenant.id,
      name: "Default",
    },
  });
  await prisma.tenant.update({ where: { id: tenant.id }, data: { defaultApiResourceId: apiResource.id } });
  return { tenant, apiResource };
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
    oauthClientMode: "proxy",
    proxyAuthStrategies: {
      ...DEFAULT_PROXY_AUTH_STRATEGIES,
      redirect: { enabled: false },
      preauthorized: { enabled: true },
    },
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
      oauthClientMode: "proxy",
      proxyAuthStrategies: {
        ...DEFAULT_PROXY_AUTH_STRATEGIES,
        redirect: { enabled: false },
        preauthorized: { enabled: true },
      },
    },
  });
};

const createTransaction = async (input: {
  tenantId: string;
  apiResourceId: string;
  clientId: string;
  adminUserId: string;
  expiresAt: Date;
}) => {
  return prisma.adminAuthTransaction.create({
    data: {
      tenantId: input.tenantId,
      apiResourceId: input.apiResourceId,
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
  apiResourceId: string;
  adminUserId: string;
  state: string;
  transactionCookie: string | null;
}) => ({
  tenantId: input.tenantId,
  apiResourceId: input.apiResourceId,
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
    const { tenant, apiResource } = await createTenant();
    const admin = await createAdminUser();
    const { client } = await createPreauthorizedClient(tenant.id);
    const transaction = await createTransaction({
      tenantId: tenant.id,
      apiResourceId: apiResource.id,
      clientId: client.id,
      adminUserId: admin.id,
      expiresAt: new Date(Date.now() + 60 * 1000),
    });

    await expect(
      completePreauthorizedAdminAuth(
        buildCallbackArgs({
          tenantId: tenant.id,
          apiResourceId: apiResource.id,
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

  it("rejects api resource mismatches", async () => {
    const { tenant, apiResource } = await createTenant();
    const admin = await createAdminUser();
    const { client } = await createPreauthorizedClient(tenant.id);
    const transaction = await createTransaction({
      tenantId: tenant.id,
      apiResourceId: apiResource.id,
      clientId: client.id,
      adminUserId: admin.id,
      expiresAt: new Date(Date.now() + 60 * 1000),
    });
    const otherResource = await prisma.apiResource.create({
      data: {
        tenantId: tenant.id,
        name: `Alt ${randomUUID()}`,
      },
    });

    await expect(
      completePreauthorizedAdminAuth(
        buildCallbackArgs({
          tenantId: tenant.id,
          apiResourceId: otherResource.id,
          adminUserId: admin.id,
          state: transaction.id,
          transactionCookie: transaction.id,
        }),
      ),
    ).rejects.toThrow("Admin transaction resource mismatch");
  });

  it("deletes expired transactions", async () => {
    const { tenant, apiResource } = await createTenant();
    const admin = await createAdminUser();
    const { client } = await createPreauthorizedClient(tenant.id);
    const transaction = await createTransaction({
      tenantId: tenant.id,
      apiResourceId: apiResource.id,
      clientId: client.id,
      adminUserId: admin.id,
      expiresAt: new Date(Date.now() - 60 * 1000),
    });

    await expect(
      completePreauthorizedAdminAuth(
        buildCallbackArgs({
          tenantId: tenant.id,
          apiResourceId: apiResource.id,
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
    const { tenant, apiResource } = await createTenant();
    const admin = await createAdminUser();
    const client = await createBarePreauthorizedClient(tenant.id);
    const transaction = await createTransaction({
      tenantId: tenant.id,
      apiResourceId: apiResource.id,
      clientId: client.id,
      adminUserId: admin.id,
      expiresAt: new Date(Date.now() + 60 * 1000),
    });

    await expect(
      completePreauthorizedAdminAuth(
        buildCallbackArgs({
          tenantId: tenant.id,
          apiResourceId: apiResource.id,
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
