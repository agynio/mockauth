import { NextResponse } from "next/server";
import { addHours } from "date-fns";
import { randomUUID } from "node:crypto";

import { prisma } from "@/server/db/client";
import { env, isProd } from "@/server/env";

type Body = {
  tenantId?: string;
};

const DEFAULT_TENANT_ID = "tenant_qa";

export async function POST(request: Request) {
  if (!env.ENABLE_TEST_ROUTES) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const payload = (await request.json().catch(() => ({}))) as Body;
  const tenantId = payload.tenantId ?? DEFAULT_TENANT_ID;

  const admin = await prisma.adminUser.upsert({
    where: { email: "pw-admin@example.test" },
    update: {},
    create: {
      email: "pw-admin@example.test",
      name: "Playwright Admin",
    },
  });

  await prisma.tenantMembership.upsert({
    where: { tenantId_adminUserId: { tenantId, adminUserId: admin.id } },
    update: {},
    create: { tenantId, adminUserId: admin.id, role: "OWNER" },
  });

  const sessionToken = randomUUID();
  await prisma.session.create({
    data: {
      sessionToken,
      userId: admin.id,
      expires: addHours(new Date(), 4),
    },
  });

  const response = NextResponse.json({ sessionToken });
  response.cookies.set("next-auth.session-token", sessionToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: isProd,
    path: "/",
    maxAge: 60 * 60 * 4,
  });

  return response;
}
