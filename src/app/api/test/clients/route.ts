import { NextResponse } from "next/server";

import { createClient } from "@/server/services/client-service";
import { env } from "@/server/env";

const DEFAULT_TENANT_ID = "tenant_qa";

type Body = {
  tenantId?: string;
  names?: string[];
  clientType?: "PUBLIC" | "CONFIDENTIAL";
};

export async function POST(request: Request) {
  if (!env.ENABLE_TEST_ROUTES) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const payload = ((await request.json().catch(() => ({}))) ?? {}) as Body;
  const tenantId = payload.tenantId ?? DEFAULT_TENANT_ID;
  const names = Array.isArray(payload.names) && payload.names.length > 0 ? payload.names : ["Playwright Client"];
  const clientType = payload.clientType ?? "CONFIDENTIAL";

  const created = [] as { id: string; name: string; clientId: string }[];
  for (const name of names) {
    const { client } = await createClient(tenantId, { name, clientType });
    created.push({ id: client.id, name: client.name, clientId: client.clientId });
  }

  return NextResponse.json({ clients: created });
}
