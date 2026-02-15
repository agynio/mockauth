import { hashSecret } from "@/server/crypto/hash";
import { classifyRedirect } from "@/server/oidc/redirect-uri";
import { prisma } from "@/server/db/client";
import { ensureActiveKey } from "@/server/services/key-service";

async function main() {
  const tenant = await prisma.tenant.upsert({
    where: { slug: "qa" },
    update: {},
    create: { slug: "qa", name: "QA Sandbox" },
  });

  await ensureActiveKey(tenant.id);

  const client = await prisma.client.upsert({
    where: { tenantId_clientId: { tenantId: tenant.id, clientId: "qa-client" } },
    update: {},
    create: {
      tenantId: tenant.id,
      name: "QA Client",
      clientId: "qa-client",
      clientSecretHash: await hashSecret("qa-secret"),
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
