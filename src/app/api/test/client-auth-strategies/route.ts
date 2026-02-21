import { NextResponse } from "next/server";

import { env } from "@/server/env";
import { prisma } from "@/server/db/client";
import { parseClientAuthStrategies, DEFAULT_CLIENT_AUTH_STRATEGIES } from "@/server/oidc/auth-strategy";
import { updateClientAuthStrategies } from "@/server/services/client-service";

const DEFAULT_TENANT_ID = "tenant_qa";

type Body = {
  tenantId?: string;
  clientId?: string;
  strategies?: unknown;
};

export async function POST(request: Request) {
  if (!env.ENABLE_TEST_ROUTES) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const payload = (await request.json().catch(() => ({}))) as Body;
  const tenantId = payload.tenantId?.trim() || DEFAULT_TENANT_ID;
  const clientId = payload.clientId?.trim();
  if (!clientId) {
    return NextResponse.json({ error: "clientId required" }, { status: 400 });
  }

  const client = await prisma.client.findFirst({ where: { tenantId, clientId } });
  if (!client) {
    return NextResponse.json({ error: "client_not_found" }, { status: 404 });
  }

  const strategies = parseClientAuthStrategies(payload.strategies ?? DEFAULT_CLIENT_AUTH_STRATEGIES);
  await updateClientAuthStrategies(client.id, strategies);

  return NextResponse.json({ clientId: client.clientId, strategies });
}
