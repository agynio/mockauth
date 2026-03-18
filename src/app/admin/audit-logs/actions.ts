"use server";

import { z } from "zod";
import { getServerSession } from "next-auth";

import { AuditLogEventType, AuditLogSeverity } from "@/generated/prisma/client";
import { authOptions } from "@/server/auth/options";
import { listAuditLogs } from "@/server/services/audit-log-service";
import { assertTenantMembership } from "@/server/services/tenant-service";

const listAuditLogsSchema = z.object({
  tenantId: z.string().min(1),
  clientId: z.string().min(1).optional().nullable(),
  eventType: z.nativeEnum(AuditLogEventType).optional().nullable(),
  severity: z.nativeEnum(AuditLogSeverity).optional().nullable(),
  traceId: z.string().min(1).optional().nullable(),
  startDate: z.string().min(1).optional().nullable(),
  endDate: z.string().min(1).optional().nullable(),
  cursor: z.string().min(1).optional().nullable(),
});

const requireSession = async () => {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }
  return session.user.id;
};

type ActionState<T = undefined> = {
  error?: string;
  success?: string;
  data?: T;
};

const parseStartDate = (value: string | null | undefined) => {
  if (!value) {
    return null;
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Invalid start date");
  }
  return date;
};

const parseEndDate = (value: string | null | undefined) => {
  if (!value) {
    return null;
  }
  const date = new Date(`${value}T23:59:59.999Z`);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Invalid end date");
  }
  return date;
};

type AuditLogEntry = {
  id: string;
  createdAt: string;
  eventType: AuditLogEventType;
  severity: AuditLogSeverity;
  message: string;
  traceId: string | null;
  client: { id: string; name: string; clientId: string } | null;
  details: Record<string, unknown> | null;
  actorId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
};

export const fetchAuditLogsAction = async (
  input: z.infer<typeof listAuditLogsSchema>,
): Promise<ActionState<{ logs: AuditLogEntry[]; nextCursor: string | null }>> => {
  try {
    const adminId = await requireSession();
    const parsed = listAuditLogsSchema.parse(input);
    await assertTenantMembership(adminId, parsed.tenantId);

    const { logs, nextCursor } = await listAuditLogs(
      {
        tenantId: parsed.tenantId,
        clientId: parsed.clientId ?? undefined,
        eventType: parsed.eventType,
        severity: parsed.severity,
        traceId: parsed.traceId ?? undefined,
        startDate: parseStartDate(parsed.startDate) ?? undefined,
        endDate: parseEndDate(parsed.endDate) ?? undefined,
      },
      { cursor: parsed.cursor ?? undefined },
    );

    return {
      success: "Audit logs loaded",
      data: {
        logs: logs.map((log) => ({
          id: log.id,
          createdAt: log.createdAt.toISOString(),
          eventType: log.eventType,
          severity: log.severity,
          message: log.message,
          traceId: log.traceId,
          client: log.client ? { id: log.client.id, name: log.client.name, clientId: log.client.clientId } : null,
          details: (log.details as Record<string, unknown>) ?? null,
          actorId: log.actorId,
          ipAddress: log.ipAddress,
          userAgent: log.userAgent,
        })),
        nextCursor,
      },
    };
  } catch (error) {
    console.error(error);
    return { error: "Unable to load audit logs" };
  }
};
