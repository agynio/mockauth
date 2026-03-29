import { NextResponse } from "next/server";
import { z } from "zod";

import { AUDIT_LOG_EVENT_TYPES, AUDIT_LOG_SEVERITIES } from "@/lib/audit-log";
import { env } from "@/server/env";
import { listAuditLogs, toAuditLogEntry } from "@/server/services/audit-log-service";

const DEFAULT_TENANT_ID = "tenant_qa";

const querySchema = z.object({
  tenantId: z.string().min(1),
  clientId: z.string().min(1).optional(),
  traceId: z.string().min(1).optional(),
  eventType: z.enum(AUDIT_LOG_EVENT_TYPES).optional(),
  severity: z.enum(AUDIT_LOG_SEVERITIES).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
  cursor: z.string().min(1).optional(),
});

const notFound = NextResponse.json({ error: "Not Found" }, { status: 404 });

export async function GET(request: Request) {
  if (!env.ENABLE_TEST_ROUTES) {
    return notFound;
  }

  const { searchParams } = new URL(request.url);
  const parsed = querySchema.safeParse({
    tenantId: searchParams.get("tenantId") ?? DEFAULT_TENANT_ID,
    clientId: searchParams.get("clientId") ?? undefined,
    traceId: searchParams.get("traceId") ?? undefined,
    eventType: searchParams.get("eventType") ?? undefined,
    severity: searchParams.get("severity") ?? undefined,
    pageSize: searchParams.get("pageSize") ?? undefined,
    cursor: searchParams.get("cursor") ?? undefined,
  });

  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const { tenantId, clientId, traceId, eventType, severity, pageSize, cursor } = parsed.data;
  const { logs, nextCursor } = await listAuditLogs(
    {
      tenantId,
      clientId,
      traceId,
      eventType,
      severity,
    },
    { pageSize, cursor },
  );

  return NextResponse.json({ logs: logs.map((log) => toAuditLogEntry(log)), nextCursor });
}
