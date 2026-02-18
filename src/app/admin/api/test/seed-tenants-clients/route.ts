import { NextResponse } from "next/server";

import { env } from "@/server/env";
import { prisma } from "@/server/db/client";
import { createTenant } from "@/server/services/tenant-service";
import { createClient } from "@/server/services/client-service";

const ADMIN_EMAIL = "pw-admin@example.test";

type SeedResponse = {
  tenantAId: string;
  tenantAName: string;
  tenantBId: string;
  tenantBName: string;
  clientsA: { id: string; name: string; clientId: string }[];
  clientsB: { id: string; name: string; clientId: string }[];
};

export async function POST() {
  if (!env.ENABLE_TEST_ROUTES) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const admin = await prisma.adminUser.upsert({
    where: { email: ADMIN_EMAIL },
    update: {},
    create: {
      email: ADMIN_EMAIL,
      name: "Playwright Admin",
    },
  });

  const timestamp = Date.now();
  const tenantAName = `Tenant Switch A ${timestamp}`;
  const tenantBName = `Tenant Switch B ${timestamp}`;

  const tenantA = await createTenant(admin.id, { name: tenantAName });
  const tenantB = await createTenant(admin.id, { name: tenantBName });

  const clientsA = await seedClients(tenantA.id, [`Tenant A Client ${timestamp}`, `Tenant A Extra ${timestamp}`]);
  const clientsB = await seedClients(tenantB.id, [`Tenant B Client ${timestamp}`, `Tenant B Extra ${timestamp + 1}`]);

  const payload: SeedResponse = {
    tenantAId: tenantA.id,
    tenantAName: tenantA.name,
    tenantBId: tenantB.id,
    tenantBName: tenantB.name,
    clientsA,
    clientsB,
  };

  return NextResponse.json(payload);
}

const seedClients = async (tenantId: string, names: string[]) => {
  const results: { id: string; name: string; clientId: string }[] = [];
  for (const name of names) {
    const { client } = await createClient(tenantId, { name, clientType: "CONFIDENTIAL" });
    results.push({ id: client.id, name: client.name, clientId: client.clientId });
  }
  return results;
};
