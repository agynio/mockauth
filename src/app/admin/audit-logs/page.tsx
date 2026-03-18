import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";

import { AuditLogsClient } from "@/app/admin/audit-logs/audit-logs-client";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AUDIT_LOG_EVENT_TYPES, AUDIT_LOG_SEVERITIES } from "@/lib/audit-log";
import { authOptions } from "@/server/auth/options";
import { listAuditLogs, toAuditLogEntry } from "@/server/services/audit-log-service";
import { getAdminTenantContext } from "@/server/services/admin-tenant-context";
import { listClientSummaries } from "@/server/services/client-service";

type SearchParams = Promise<{
  clientId?: string;
  eventType?: string;
  severity?: string;
  traceId?: string;
  startDate?: string;
  endDate?: string;
}>;

const PAGE_SIZE = 50;

const parseEnumValue = <T extends string>(value: string | undefined, allowed: readonly T[]): T | null => {
  if (!value) {
    return null;
  }
  return allowed.includes(value as T) ? (value as T) : null;
};

const parseStartDate = (value: string | undefined) => {
  if (!value) {
    return null;
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
};

const parseEndDate = (value: string | undefined) => {
  if (!value) {
    return null;
  }
  const date = new Date(`${value}T23:59:59.999Z`);
  return Number.isNaN(date.getTime()) ? null : date;
};

export default async function AuditLogsPage({ searchParams }: { searchParams: SearchParams }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    redirect("/api/auth/signin");
  }

  const resolved = await searchParams;
  const clientId = typeof resolved?.clientId === "string" ? resolved.clientId : null;
  const eventType = parseEnumValue(resolved?.eventType, AUDIT_LOG_EVENT_TYPES);
  const severity = parseEnumValue(resolved?.severity, AUDIT_LOG_SEVERITIES);
  const traceId = typeof resolved?.traceId === "string" ? resolved.traceId.trim() || null : null;
  const startDate = typeof resolved?.startDate === "string" ? resolved.startDate : null;
  const endDate = typeof resolved?.endDate === "string" ? resolved.endDate : null;

  const { activeTenant, activeMembership } = await getAdminTenantContext(session.user.id);
  if (!activeTenant || !activeMembership) {
    return <NoTenantState />;
  }

  const viewerRole = activeMembership.role;
  const [clients, auditLogs] = await Promise.all([
    listClientSummaries(activeTenant.id),
    listAuditLogs(
      {
        tenantId: activeTenant.id,
        clientId: clientId || undefined,
        eventType,
        severity,
        traceId: traceId || undefined,
        startDate: parseStartDate(startDate ?? undefined) ?? undefined,
        endDate: parseEndDate(endDate ?? undefined) ?? undefined,
      },
      { pageSize: PAGE_SIZE },
    ),
  ]);

  const initialLogs = auditLogs.logs.map((log) => toAuditLogEntry(log));

  return (
    <AuditLogsClient
      tenant={activeTenant}
      viewerRole={viewerRole}
      clients={clients}
      initialLogs={initialLogs}
      initialCursor={auditLogs.nextCursor}
      initialFilters={{
        clientId,
        eventType,
        severity,
        traceId,
        startDate,
        endDate,
      }}
    />
  );
}

const NoTenantState = () => (
  <Card className="border-dashed">
    <CardHeader className="text-center">
      <CardTitle>No tenants yet</CardTitle>
      <CardDescription>Create or activate a tenant from the sidebar to view audit logs.</CardDescription>
    </CardHeader>
  </Card>
);
