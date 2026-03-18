"use client";

import { useState, useTransition } from "react";
import { format } from "date-fns";

import { fetchAuditLogsAction } from "@/app/admin/audit-logs/actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/components/ui/use-toast";
import {
  AUDIT_LOG_EVENT_TYPES,
  AUDIT_LOG_SEVERITIES,
  type AuditLogEventType,
  type AuditLogSeverity,
} from "@/lib/audit-log";

type ClientSummary = { id: string; name: string; clientId: string };

type TenantSummary = { id: string; name: string };

type AuditLogRecord = {
  id: string;
  createdAt: string;
  eventType: AuditLogEventType;
  severity: AuditLogSeverity;
  message: string;
  traceId: string | null;
  client: ClientSummary | null;
  details: Record<string, unknown> | null;
  actorId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
};

type FilterState = {
  clientId: string | null;
  eventType: AuditLogEventType | null;
  severity: AuditLogSeverity | null;
  traceId: string | null;
  startDate: string | null;
  endDate: string | null;
};

type AuditLogsClientProps = {
  tenant: TenantSummary;
  viewerRole: string;
  clients: ClientSummary[];
  initialLogs: AuditLogRecord[];
  initialCursor: string | null;
  initialFilters: FilterState;
  redactionEnabled: boolean;
};

const formatEnumLabel = (value: string) =>
  value
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

const formatTimestamp = (value: string) => {
  return format(new Date(value), "yyyy-MM-dd HH:mm:ss");
};

const formatDetails = (details: Record<string, unknown> | null) => {
  if (!details) {
    return null;
  }
  const entries = Object.entries(details);
  if (entries.length === 0) {
    return null;
  }
  return entries
    .map(([key, value]) => {
      if (value === null || value === undefined) {
        return null;
      }
      const formatted = typeof value === "string" ? value : JSON.stringify(value);
      return `${key}: ${formatted}`;
    })
    .filter(Boolean)
    .join(" · ");
};

const severityBadgeVariant = (severity: AuditLogSeverity) => {
  switch (severity) {
    case "ERROR":
      return "destructive";
    case "WARN":
      return "secondary";
    case "INFO":
      return "default";
  }
  const _exhaustive: never = severity;
  throw new Error(`Unhandled audit severity: ${_exhaustive}`);
};

export const AuditLogsClient = ({
  tenant,
  viewerRole,
  clients,
  initialLogs,
  initialCursor,
  initialFilters,
  redactionEnabled,
}: AuditLogsClientProps) => {
  const { toast } = useToast();
  const [filters, setFilters] = useState<FilterState>(initialFilters);
  const [logs, setLogs] = useState<AuditLogRecord[]>(initialLogs);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [pending, startTransition] = useTransition();

  const eventTypeOptions = AUDIT_LOG_EVENT_TYPES;
  const severityOptions = AUDIT_LOG_SEVERITIES;

  const fetchLogs = (options?: { nextFilters?: FilterState; cursor?: string | null; append?: boolean }) => {
    const nextFilters = options?.nextFilters ?? filters;
    const cursorValue = options?.cursor ?? null;
    const append = options?.append ?? false;

    startTransition(async () => {
      const result = await fetchAuditLogsAction({
        tenantId: tenant.id,
        clientId: nextFilters.clientId ?? null,
        eventType: nextFilters.eventType ?? null,
        severity: nextFilters.severity ?? null,
        traceId: nextFilters.traceId ?? null,
        startDate: nextFilters.startDate ?? null,
        endDate: nextFilters.endDate ?? null,
        cursor: cursorValue,
      });

      if (result.error || !result.data) {
        toast({
          title: "Unable to load audit logs",
          description: result.error ?? "Please try again.",
          variant: "destructive",
        });
        return;
      }

      const data = result.data;
      setLogs((prev) => (append ? [...prev, ...data.logs] : data.logs));
      setCursor(data.nextCursor);
    });
  };

  const applyFilters = () => {
    fetchLogs({ nextFilters: filters, cursor: null, append: false });
  };

  const resetFilters = () => {
    const reset: FilterState = {
      clientId: null,
      eventType: null,
      severity: null,
      traceId: null,
      startDate: null,
      endDate: null,
    };
    setFilters(reset);
    fetchLogs({ nextFilters: reset, cursor: null, append: false });
  };

  const handleTraceSelect = (traceId: string) => {
    const nextFilters = { ...filters, traceId };
    setFilters(nextFilters);
    fetchLogs({ nextFilters, cursor: null, append: false });
  };

  const handleLoadMore = () => {
    if (!cursor) {
      return;
    }
    fetchLogs({ cursor, append: true });
  };

  return (
    <div className="space-y-8">
      <header>
        <p className="text-sm uppercase tracking-wide text-muted-foreground">Tenant · {tenant.name}</p>
        <h1 className="text-3xl font-semibold tracking-tight">Audit logs</h1>
        <p className="text-sm text-muted-foreground">Review authentication and configuration activity.</p>
        <p className="mt-1 text-xs text-muted-foreground">Your role: {viewerRole.toLowerCase()}.</p>
      </header>

      {!redactionEnabled ? (
        <Alert variant="destructive">
          <AlertTitle>Redaction disabled</AlertTitle>
          <AlertDescription>Sensitive values are logged in this environment for QA/Debug only.</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
          <CardDescription>Filter audit logs by client, severity, event type, trace, or date.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="audit-client">Client</Label>
              <Select
                value={filters.clientId ?? "all"}
                onValueChange={(value) => setFilters((prev) => ({ ...prev, clientId: value === "all" ? null : value }))}
              >
                <SelectTrigger id="audit-client">
                  <SelectValue placeholder="All clients" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All clients</SelectItem>
                  {clients.map((client) => (
                    <SelectItem key={client.id} value={client.id}>
                      {client.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="audit-event">Event type</Label>
              <Select
                value={filters.eventType ?? "all"}
                onValueChange={(value) =>
                  setFilters((prev) => ({
                    ...prev,
                    eventType: value === "all" ? null : (value as AuditLogEventType),
                  }))
                }
              >
                <SelectTrigger id="audit-event">
                  <SelectValue placeholder="All events" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All events</SelectItem>
                  {eventTypeOptions.map((event) => (
                    <SelectItem key={event} value={event}>
                      {formatEnumLabel(event)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="audit-severity">Severity</Label>
              <Select
                value={filters.severity ?? "all"}
                onValueChange={(value) =>
                  setFilters((prev) => ({
                    ...prev,
                    severity: value === "all" ? null : (value as AuditLogSeverity),
                  }))
                }
              >
                <SelectTrigger id="audit-severity">
                  <SelectValue placeholder="All severities" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All severities</SelectItem>
                  {severityOptions.map((severity) => (
                    <SelectItem key={severity} value={severity}>
                      {formatEnumLabel(severity)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="audit-trace">Trace ID</Label>
              <Input
                id="audit-trace"
                value={filters.traceId ?? ""}
                onChange={(event) =>
                  setFilters((prev) => ({ ...prev, traceId: event.target.value.trim() || null }))
                }
                placeholder="Trace ID"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="audit-start">Start date</Label>
              <Input
                id="audit-start"
                type="date"
                value={filters.startDate ?? ""}
                onChange={(event) =>
                  setFilters((prev) => ({ ...prev, startDate: event.target.value || null }))
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="audit-end">End date</Label>
              <Input
                id="audit-end"
                type="date"
                value={filters.endDate ?? ""}
                onChange={(event) => setFilters((prev) => ({ ...prev, endDate: event.target.value || null }))}
              />
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-3">
            <Button onClick={applyFilters} disabled={pending}>
              Apply filters
            </Button>
            <Button variant="outline" onClick={resetFilters} disabled={pending}>
              Clear filters
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Audit events</CardTitle>
          <CardDescription>{logs.length === 0 ? "No matching audit logs." : `${logs.length} events loaded.`}</CardDescription>
        </CardHeader>
        <CardContent>
          {logs.length === 0 ? (
            <div className="rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">
              No audit events match the selected filters.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Timestamp</TableHead>
                  <TableHead>Event</TableHead>
                  <TableHead>Severity</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Trace</TableHead>
                  <TableHead>Message</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((log) => {
                  const details = formatDetails(log.details);
                  const meta = [
                    log.actorId ? `Actor ${log.actorId}` : null,
                    log.ipAddress ? `IP ${log.ipAddress}` : null,
                    log.userAgent ? log.userAgent : null,
                  ]
                    .filter(Boolean)
                    .join(" · ");

                  return (
                    <TableRow key={log.id} data-testid="audit-log-row">
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {formatTimestamp(log.createdAt)}
                      </TableCell>
                      <TableCell>{formatEnumLabel(log.eventType)}</TableCell>
                      <TableCell>
                        <Badge variant={severityBadgeVariant(log.severity)}>{formatEnumLabel(log.severity)}</Badge>
                      </TableCell>
                      <TableCell>
                        {log.client ? (
                          <div className="space-y-1">
                            <p className="text-sm font-medium">{log.client.name}</p>
                            <p className="font-mono text-xs text-muted-foreground">{log.client.clientId}</p>
                          </div>
                        ) : (
                          <span className="text-sm text-muted-foreground">Tenant</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {log.traceId ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-auto px-2 py-1 font-mono text-xs"
                            onClick={() => handleTraceSelect(log.traceId ?? "")}
                            data-testid="trace-drill-in"
                          >
                            {log.traceId}
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="max-w-[340px]">
                        <div className="space-y-1">
                          <p className="text-sm">{log.message}</p>
                          {details ? <p className="text-xs text-muted-foreground">{details}</p> : null}
                          {meta ? <p className="text-xs text-muted-foreground">{meta}</p> : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {cursor ? (
        <div className="flex justify-center">
          <Button variant="outline" onClick={handleLoadMore} disabled={pending}>
            Load more
          </Button>
        </div>
      ) : null}
    </div>
  );
};
