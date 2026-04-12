import { hashSecret } from "@/server/crypto/hash";
import { encrypt } from "@/server/crypto/key-vault";
import { prisma } from "@/server/db/client";
import { classifyRedirect } from "@/server/oidc/redirect-uri";
import { ensureActiveKeyForAlg } from "@/server/services/key-service";
import { DEFAULT_JWT_SIGNING_ALG } from "@/server/oidc/signing-alg";

const DEFAULT_TENANT_ID = "tenant_qa";
const DEFAULT_TENANT_NAME = "QA Sandbox";
const DEFAULT_CLIENT_ID = "qa-client";
const DEFAULT_CLIENT_SECRET = "qa-secret";
const REFRESH_CLIENT_ID = "qa-refresh-client";
const REFRESH_CLIENT_SECRET = "qa-refresh-secret";
const OWNER_EMAIL = "owner@example.test";
const WRITER_EMAIL = "writer@example.test";
const READER_EMAIL = "reader@example.test";

async function main() {
  const tenant = await prisma.tenant.upsert({
    where: { id: DEFAULT_TENANT_ID },
    update: {},
    create: { id: DEFAULT_TENANT_ID, name: DEFAULT_TENANT_NAME },
  });

  const defaultResourceId = tenant.defaultApiResourceId ?? `${tenant.id}_default_resource`;
  const apiResource = await prisma.apiResource.upsert({
    where: { id: defaultResourceId },
    update: { name: `${tenant.name} default` },
    create: { id: defaultResourceId, tenantId: tenant.id, name: `${tenant.name} default` },
  });

  if (!tenant.defaultApiResourceId) {
    await prisma.tenant.update({ where: { id: tenant.id }, data: { defaultApiResourceId: apiResource.id } });
  }

  await ensureActiveKeyForAlg(tenant.id, DEFAULT_JWT_SIGNING_ALG);

  const client = await prisma.client.upsert({
    where: { tenantId_clientId: { tenantId: tenant.id, clientId: DEFAULT_CLIENT_ID } },
    update: {},
    create: {
      tenantId: tenant.id,
      name: "QA Client",
      clientId: DEFAULT_CLIENT_ID,
      clientSecretHash: await hashSecret(DEFAULT_CLIENT_SECRET),
      clientSecretEncrypted: encrypt(DEFAULT_CLIENT_SECRET),
      tokenEndpointAuthMethods: ["client_secret_post"],
    },
  });

  const refreshClient = await prisma.client.upsert({
    where: { tenantId_clientId: { tenantId: tenant.id, clientId: REFRESH_CLIENT_ID } },
    update: {},
    create: {
      tenantId: tenant.id,
      name: "QA Refresh Client",
      clientId: REFRESH_CLIENT_ID,
      clientSecretHash: await hashSecret(REFRESH_CLIENT_SECRET),
      clientSecretEncrypted: encrypt(REFRESH_CLIENT_SECRET),
      allowedGrantTypes: ["authorization_code", "refresh_token"],
      allowedScopes: ["openid", "profile", "email", "offline_access"],
      tokenEndpointAuthMethods: ["client_secret_post"],
    },
  });

  const redirectMeta = classifyRedirect("https://client.example.test/callback");
  await prisma.redirectUri.upsert({
    where: { clientId_uri: { clientId: client.id, uri: redirectMeta.normalized } },
    update: {},
    create: { clientId: client.id, uri: redirectMeta.normalized, type: redirectMeta.type },
  });

  await prisma.redirectUri.upsert({
    where: { clientId_uri: { clientId: refreshClient.id, uri: redirectMeta.normalized } },
    update: {},
    create: { clientId: refreshClient.id, uri: redirectMeta.normalized, type: redirectMeta.type },
  });

  await prisma.mockUser.upsert({
    where: { tenantId_username: { tenantId: tenant.id, username: "demo" } },
    update: {},
    create: { tenantId: tenant.id, username: "demo", displayName: "Demo User" },
  });

  const [owner, writer, reader] = await Promise.all([
    prisma.adminUser.upsert({
      where: { email: OWNER_EMAIL },
      update: {},
      create: { email: OWNER_EMAIL, name: "QA Owner" },
    }),
    prisma.adminUser.upsert({
      where: { email: WRITER_EMAIL },
      update: {},
      create: { email: WRITER_EMAIL, name: "QA Writer" },
    }),
    prisma.adminUser.upsert({
      where: { email: READER_EMAIL },
      update: {},
      create: { email: READER_EMAIL, name: "QA Reader" },
    }),
  ]);

  await prisma.tenantMembership.upsert({
    where: { tenantId_adminUserId: { tenantId: tenant.id, adminUserId: owner.id } },
    update: { role: "OWNER" },
    create: { tenantId: tenant.id, adminUserId: owner.id, role: "OWNER" },
  });

  await prisma.tenantMembership.upsert({
    where: { tenantId_adminUserId: { tenantId: tenant.id, adminUserId: writer.id } },
    update: { role: "WRITER" },
    create: { tenantId: tenant.id, adminUserId: writer.id, role: "WRITER" },
  });

  await prisma.tenantMembership.upsert({
    where: { tenantId_adminUserId: { tenantId: tenant.id, adminUserId: reader.id } },
    update: { role: "READER" },
    create: { tenantId: tenant.id, adminUserId: reader.id, role: "READER" },
  });
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
