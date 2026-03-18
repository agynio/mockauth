import type { Prisma } from "@/generated/prisma/client";
import type { AuditLogEventType, AuditLogSeverity } from "@/generated/prisma/client";

import { prisma } from "@/server/db/client";

export type AuditLogFilters = {
  tenantId: string;
  clientId?: string | null;
  eventType?: AuditLogEventType | null;
  severity?: AuditLogSeverity | null;
  traceId?: string | null;
  startDate?: Date | null;
  endDate?: Date | null;
};

export type AuditLogCursor = {
  id: string;
  createdAt: Date;
};

export type AuditLogPage = {
  logs: Array<Prisma.AuditLogGetPayload<{ include: { client: { select: { id: true; name: true; clientId: true } } } }>>;
  nextCursor: string | null;
};

const DEFAULT_PAGE_SIZE = 50;

const encodeCursor = (cursor: AuditLogCursor) => {
  return Buffer.from(JSON.stringify({ id: cursor.id, createdAt: cursor.createdAt.toISOString() })).toString("base64");
};

const decodeCursor = (cursor: string): AuditLogCursor | null => {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64").toString("utf8")) as {
      id?: string;
      createdAt?: string;
    };
    if (!parsed?.id || !parsed?.createdAt) {
      return null;
    }
    const createdAt = new Date(parsed.createdAt);
    if (Number.isNaN(createdAt.getTime())) {
      return null;
    }
    return { id: parsed.id, createdAt };
  } catch {
    return null;
  }
};

const buildBaseWhere = (filters: AuditLogFilters): Prisma.AuditLogWhereInput => {
  const createdAt: Prisma.DateTimeFilter<"AuditLog"> = {};
  if (filters.startDate) {
    createdAt.gte = filters.startDate;
  }
  if (filters.endDate) {
    createdAt.lte = filters.endDate;
  }

  const createdAtFilter = Object.keys(createdAt).length > 0 ? { createdAt } : {};

  return {
    tenantId: filters.tenantId,
    ...(filters.clientId ? { clientId: filters.clientId } : {}),
    ...(filters.eventType ? { eventType: filters.eventType } : {}),
    ...(filters.severity ? { severity: filters.severity } : {}),
    ...(filters.traceId ? { traceId: filters.traceId } : {}),
    ...createdAtFilter,
  };
};

export const listAuditLogs = async (
  filters: AuditLogFilters,
  options?: { pageSize?: number; cursor?: string | null },
): Promise<AuditLogPage> => {
  const pageSize = Math.max(1, options?.pageSize ?? DEFAULT_PAGE_SIZE);
  const cursor = options?.cursor ? decodeCursor(options.cursor) : null;
  const baseWhere = buildBaseWhere(filters);

  const where: Prisma.AuditLogWhereInput = cursor
    ? {
        AND: [
          baseWhere,
          {
            OR: [
              { createdAt: { lt: cursor.createdAt } },
              { createdAt: cursor.createdAt, id: { lt: cursor.id } },
            ],
          },
        ],
      }
    : baseWhere;

  const logs = await prisma.auditLog.findMany({
    where,
    include: {
      client: { select: { id: true, name: true, clientId: true } },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: pageSize + 1,
  });

  let nextCursor: string | null = null;
  if (logs.length > pageSize) {
    const next = logs.pop();
    if (next) {
      nextCursor = encodeCursor({ id: next.id, createdAt: next.createdAt });
    }
  }

  return { logs, nextCursor };
};
