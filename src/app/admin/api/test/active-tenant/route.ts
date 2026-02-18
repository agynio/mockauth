import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { env } from "@/server/env";
import { ADMIN_ACTIVE_TENANT_COOKIE } from "@/server/services/admin-tenant-context";

export async function GET() {
  if (!env.ENABLE_TEST_ROUTES) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const store = await cookies();
  const activeTenantId = store.get(ADMIN_ACTIVE_TENANT_COOKIE)?.value ?? null;

  return NextResponse.json({ activeTenantId });
}
