import { NextResponse, type NextRequest } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/server/auth/options";
import { prisma } from "@/server/db/client";
import { assertTenantMembership } from "@/server/services/tenant-service";
import { clearOauthTestSecretCookie } from "@/server/oauth/test-cookie";

type RouteParams = { params: Promise<{ clientId: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { clientId } = await params;
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = ((await request.json().catch(() => ({}))) ?? {}) as { state?: string };
  const state = payload.state?.trim();
  if (!state) {
    return NextResponse.json({ error: "State is required" }, { status: 400 });
  }

  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { tenantId: true } });
  if (!client) {
    return NextResponse.json({ error: "Client not found" }, { status: 404 });
  }

  await assertTenantMembership(session.user.id, client.tenantId);
  await clearOauthTestSecretCookie(clientId, state);
  return NextResponse.json({ ok: true });
}
