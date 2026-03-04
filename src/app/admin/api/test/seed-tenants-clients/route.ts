import { NextResponse } from "next/server";

import { env } from "@/server/env";
import { prisma } from "@/server/db/client";
import { createTenant } from "@/server/services/tenant-service";
import { createClient } from "@/server/services/client-service";

const ADMIN_EMAIL = "pw-admin@example.test";

type SeedRequest = {
  adminEmail?: string;
};

type SeedResponse = {
  tenantAId: string;
  tenantAResourceId: string;
  tenantAName: string;
  tenantBId: string;
  tenantBResourceId: string;
  tenantBName: string;
  clientsA: { id: string; name: string; clientId: string }[];
  clientsB: { id: string; name: string; clientId: string }[];
};

const isUniqueConstraintError = (error: unknown): error is { code?: string } =>
  typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "P2002";

export async function POST(request: Request) {
  if (!env.ENABLE_TEST_ROUTES) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const payload = (await request.json().catch(() => ({}))) as SeedRequest;
  const adminEmail = payload.adminEmail?.toLowerCase().trim() || ADMIN_EMAIL;

  const admin = await prisma.adminUser
    .upsert({
      where: { email: adminEmail },
      update: {},
      create: {
        email: adminEmail,
        name: "Playwright Admin",
      },
    })
    .catch(async (error) => {
      if (isUniqueConstraintError(error)) {
        return prisma.adminUser.findUniqueOrThrow({ where: { email: adminEmail } });
      }
      throw error;
    });

  const timestamp = Date.now();
  const tenantAName = `Tenant Switch A ${timestamp}`;
  const tenantBName = `Tenant Switch B ${timestamp}`;

  const tenantA = await createTenant(admin.id, { name: tenantAName });
  const tenantB = await createTenant(admin.id, { name: tenantBName });

  const clientsA = await seedClients(tenantA.id, [`Tenant A Client ${timestamp}`, `Tenant A Extra ${timestamp}`]);
  const clientsB = await seedClients(tenantB.id, [`Tenant B Client ${timestamp}`, `Tenant B Extra ${timestamp + 1}`]);

  const responsePayload: SeedResponse = {
    tenantAId: tenantA.id,
    tenantAResourceId: tenantA.defaultApiResourceId!,
    tenantAName: tenantA.name,
    tenantBId: tenantB.id,
    tenantBResourceId: tenantB.defaultApiResourceId!,
    tenantBName: tenantB.name,
    clientsA,
    clientsB,
  };

  return NextResponse.json(responsePayload);
}

const seedClients = async (tenantId: string, names: string[]) => {
  const results: { id: string; name: string; clientId: string }[] = [];
  for (const name of names) {
    const { client } = await createClient(tenantId, { name, clientType: "CONFIDENTIAL" });
    results.push({ id: client.id, name: client.name, clientId: client.clientId });
  }
  return results;
};
