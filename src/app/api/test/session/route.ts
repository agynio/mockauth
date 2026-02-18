import { NextResponse } from "next/server";
import { addHours } from "date-fns";
import { randomUUID } from "node:crypto";

import { prisma } from "@/server/db/client";
import { env, isProd } from "@/server/env";

type Body = {
  tenantId?: string;
  email?: string;
  name?: string;
  role?: "OWNER" | "WRITER" | "READER";
  assignMembership?: boolean;
};

const DEFAULT_TENANT_ID = "tenant_qa";

export async function POST(request: Request) {
  if (!env.ENABLE_TEST_ROUTES) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const payload = (await request.json().catch(() => ({}))) as Body;
  const tenantId = payload.tenantId ?? DEFAULT_TENANT_ID;

  const email = payload.email?.toLowerCase() || "pw-admin@example.test";
  const name = payload.name ?? "Playwright Admin";

  const admin = await prisma.adminUser.upsert({
    where: { email },
    update: { name },
    create: {
      email,
      name,
    },
  });

  const shouldAssignMembership = payload.assignMembership ?? true;
  if (shouldAssignMembership) {
    const requestedRole = payload.role && ["OWNER", "WRITER", "READER"].includes(payload.role) ? payload.role : "OWNER";
    await prisma.tenantMembership.upsert({
      where: { tenantId_adminUserId: { tenantId, adminUserId: admin.id } },
      update: { role: requestedRole },
      create: { tenantId, adminUserId: admin.id, role: requestedRole },
    });
  }

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
