"use server";

import { z } from "zod";
import { getServerSession } from "next-auth";

import { AUDIT_LOG_EVENT_TYPES, AUDIT_LOG_SEVERITIES } from "@/lib/audit-log";
import { authOptions } from "@/server/auth/options";
import { listAuditLogs, toAuditLogEntry, type AuditLogEntry } from "@/server/services/audit-log-service";
import { assertTenantMembership } from "@/server/services/tenant-service";

const listAuditLogsSchema = z.object({
  tenantId: z.string().min(1),
  clientId: z.string().min(1).optional().nullable(),
  eventType: z.enum(AUDIT_LOG_EVENT_TYPES).optional().nullable(),
  severity: z.enum(AUDIT_LOG_SEVERITIES).optional().nullable(),
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
        logs: logs.map((log) => toAuditLogEntry(log)),
        nextCursor,
      },
    };
  } catch (error) {
    console.error(error);
    return { error: "Unable to load audit logs" };
  }
};
