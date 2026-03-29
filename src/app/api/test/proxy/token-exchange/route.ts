import { NextResponse } from "next/server";
import { z } from "zod";

import { env } from "@/server/env";
import { prisma } from "@/server/db/client";
import { decrypt } from "@/server/crypto/key-vault";

const querySchema = z.object({
  transactionId: z.string().min(1),
  tenantId: z.string().min(1).optional(),
  clientId: z.string().min(1).optional(),
});

const notFound = NextResponse.json({ error: "Not Found" }, { status: 404 });

export async function GET(request: Request) {
  if (!env.ENABLE_TEST_ROUTES) {
    return notFound;
  }

  const { searchParams } = new URL(request.url);
  const parsed = querySchema.safeParse({
    transactionId: searchParams.get("transactionId"),
    tenantId: searchParams.get("tenantId") ?? undefined,
    clientId: searchParams.get("clientId") ?? undefined,
  });

  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const { transactionId, tenantId, clientId } = parsed.data;
  const exchange = await prisma.proxyTokenExchange.findFirst({
    where: {
      transactionId,
      ...(tenantId ? { tenantId } : {}),
      ...(clientId ? { clientId } : {}),
    },
  });

  if (!exchange) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const providerResponse = JSON.parse(decrypt(exchange.providerResponseEncrypted)) as Record<string, unknown>;

  return NextResponse.json({
    exchange: {
      id: exchange.id,
      transactionId: exchange.transactionId,
      clientId: exchange.clientId,
      providerResponse,
    },
  });
}
