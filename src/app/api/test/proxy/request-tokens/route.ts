import { NextResponse } from "next/server";
import { z } from "zod";

import { env } from "@/server/env";
import { prisma } from "@/server/db/client";
import { requestProviderTokens } from "@/server/services/proxy-service";
import { DomainError, toResponse } from "@/server/errors";

const payloadSchema = z.object({
  clientId: z.string().min(1),
  tenantId: z.string().min(1).optional(),
  parameters: z.record(z.string(), z.string()),
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

  const { clientId, tenantId, parameters } = parsed.data;

  const client = await prisma.client.findFirst({
    where: tenantId ? { clientId, tenantId } : { clientId },
    include: { proxyConfig: true },
  });

  if (!client?.proxyConfig) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(parameters)) {
    params.set(key, value);
  }

  try {
    const result = await requestProviderTokens(client.proxyConfig, params);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof DomainError) {
      return toResponse(error);
    }
    console.error("proxy_request_tokens_failed", error);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
