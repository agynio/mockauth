import { hashSecret } from "@/server/crypto/hash";
import { classifyRedirect } from "@/server/oidc/redirect-uri";
import { prisma } from "@/server/db/client";
import { ensureActiveKey } from "@/server/services/key-service";

const DEFAULT_TENANT_ID = "tenant_qa";
const DEFAULT_TENANT_NAME = "QA Sandbox";
const DEFAULT_CLIENT_ID = "qa-client";
const DEFAULT_CLIENT_SECRET = "qa-secret";

async function main() {
  const tenant = await prisma.tenant.upsert({
    where: { id: DEFAULT_TENANT_ID },
    update: {},
    create: { id: DEFAULT_TENANT_ID, name: DEFAULT_TENANT_NAME },
  });

  await ensureActiveKey(tenant.id);

  const client = await prisma.client.upsert({
    where: { tenantId_clientId: { tenantId: tenant.id, clientId: DEFAULT_CLIENT_ID } },
    update: {},
    create: {
      tenantId: tenant.id,
      name: "QA Client",
      clientId: DEFAULT_CLIENT_ID,
      clientSecretHash: await hashSecret(DEFAULT_CLIENT_SECRET),
      tokenEndpointAuthMethod: "client_secret_post",
    },
  });

  const redirectMeta = classifyRedirect("https://client.example.test/callback");
  await prisma.redirectUri.upsert({
    where: { clientId_uri: { clientId: client.id, uri: redirectMeta.normalized } },
    update: {},
    create: { clientId: client.id, uri: redirectMeta.normalized, type: redirectMeta.type },
  });

  await prisma.mockUser.upsert({
    where: { tenantId_username: { tenantId: tenant.id, username: "demo" } },
    update: {},
    create: { tenantId: tenant.id, username: "demo", displayName: "Demo User" },
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
