import { NextResponse } from "next/server";

import { env } from "@/server/env";
import { prisma } from "@/server/db/client";

type Body = {
  tenantId?: string;
};

export async function POST(request: Request) {
  if (!env.ENABLE_TEST_ROUTES) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const payload = (await request.json().catch(() => ({}))) as Body;
  const tenantId = payload.tenantId?.trim();
  if (!tenantId) {
    return NextResponse.json({ error: "tenantId required" }, { status: 400 });
  }

  const [tenant, clients, apiResources, redirectUris, keys, memberships, invites, authorizationCodes, accessTokens, mockUsers, mockSessions] = await Promise.all([
    prisma.tenant.findUnique({ where: { id: tenantId } }),
    prisma.client.count({ where: { tenantId } }),
    prisma.apiResource.count({ where: { tenantId } }),
    prisma.redirectUri.count({ where: { client: { tenantId } } }),
    prisma.tenantKey.count({ where: { tenantId } }),
    prisma.tenantMembership.count({ where: { tenantId } }),
    prisma.invite.count({ where: { tenantId } }),
    prisma.authorizationCode.count({ where: { tenantId } }),
    prisma.accessToken.count({ where: { tenantId } }),
    prisma.mockUser.count({ where: { tenantId } }),
    prisma.mockSession.count({ where: { tenantId } }),
  ]);

  return NextResponse.json({
    tenantExists: Boolean(tenant),
    counts: {
      clients,
      apiResources,
      redirectUris,
      keys,
      memberships,
      invites,
      authorizationCodes,
      accessTokens,
      mockUsers,
      mockSessions,
    },
  });
}
