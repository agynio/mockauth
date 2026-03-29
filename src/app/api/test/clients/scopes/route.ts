import { NextResponse } from "next/server";
import { z } from "zod";

import { env } from "@/server/env";
import { prisma } from "@/server/db/client";
import { isValidScopeValue, normalizeScopes } from "@/server/oidc/scopes";

const payloadSchema = z.object({
  clientId: z.string().min(1),
  scopes: z.array(z.string().min(1)),
});

const notFound = NextResponse.json({ error: "Not Found" }, { status: 404 });

export async function POST(request: Request) {
  if (!env.ENABLE_TEST_ROUTES) {
    return notFound;
  }

  const payload = await request.json().catch(() => null);
  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const normalized = normalizeScopes(parsed.data.scopes);
  if (!normalized.includes("openid")) {
    return NextResponse.json({ error: "missing_openid" }, { status: 400 });
  }
  const invalid = normalized.filter((scope) => !isValidScopeValue(scope));
  if (invalid.length > 0) {
    return NextResponse.json({ error: `invalid_scope:${invalid.join(",")}` }, { status: 400 });
  }

  const canonical = ["openid", ...normalized.filter((scope) => scope !== "openid")];
  const existing = await prisma.client.findUnique({ where: { id: parsed.data.clientId } });
  if (!existing) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const updated = await prisma.client.update({
    where: { id: parsed.data.clientId },
    data: { allowedScopes: canonical },
  });

  return NextResponse.json({ clientId: updated.id, allowedScopes: updated.allowedScopes });
}
