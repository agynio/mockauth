/* @vitest-environment jsdom */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuditLogEventType, AuditLogSeverity } from "@/lib/audit-log";

import { AuditLogsClient } from "../audit-logs-client";

const mockFetchAuditLogsAction = vi.hoisted(() => vi.fn());

vi.mock("@/app/admin/audit-logs/actions", () => ({
  fetchAuditLogsAction: mockFetchAuditLogsAction,
}));

describe("AuditLogsClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const baseProps = {
    tenant: { id: "tenant_1", name: "Tenant One" },
    viewerRole: "OWNER",
    clients: [
      { id: "client_1", name: "App One", clientId: "app-one" },
      { id: "client_2", name: "App Two", clientId: "app-two" },
    ],
    initialLogs: [
      {
        id: "log-1",
        createdAt: "2024-05-01T12:00:00.000Z",
        eventType: "AUTHORIZE_RECEIVED" as AuditLogEventType,
        severity: "INFO" as AuditLogSeverity,
        message: "Authorization request received",
        traceId: "trace-123",
        client: { id: "client_1", name: "App One", clientId: "app-one" },
        details: { scope: "openid" },
        actorId: null,
        ipAddress: "203.0.113.4",
        userAgent: "TestAgent",
      },
    ],
    initialCursor: null,
    initialFilters: {
      clientId: null,
      eventType: null,
      severity: null,
      traceId: null,
      startDate: null,
      endDate: null,
    },
  };

  it("applies filter selections", async () => {
    const user = userEvent.setup();
    mockFetchAuditLogsAction.mockResolvedValueOnce({
      success: "Audit logs loaded",
      data: {
        logs: [
          {
            id: "log-2",
            createdAt: "2024-05-02T12:00:00.000Z",
            eventType: "TOKEN_AUTHCODE_COMPLETED" as AuditLogEventType,
            severity: "INFO" as AuditLogSeverity,
            message: "Token response issued",
            traceId: "trace-456",
            client: { id: "client_2", name: "App Two", clientId: "app-two" },
            details: { tokenType: "Bearer" },
            actorId: null,
            ipAddress: null,
            userAgent: null,
          },
        ],
        nextCursor: null,
      },
    });

    render(<AuditLogsClient {...baseProps} />);

    await user.click(screen.getByRole("button", { name: "Apply filters" }));

    await waitFor(() => {
      expect(mockFetchAuditLogsAction).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: "tenant_1", clientId: null }),
      );
    });

    expect(await screen.findByText("Token response issued")).toBeInTheDocument();
  });

  it("drills into trace IDs", async () => {
    const user = userEvent.setup();
    mockFetchAuditLogsAction.mockResolvedValueOnce({
      success: "Audit logs loaded",
      data: {
        logs: [
          {
            id: "log-3",
            createdAt: "2024-05-03T12:00:00.000Z",
            eventType: "TOKEN_AUTHCODE_RECEIVED" as AuditLogEventType,
            severity: "INFO" as AuditLogSeverity,
            message: "Token request received",
            traceId: "trace-123",
            client: { id: "client_1", name: "App One", clientId: "app-one" },
            details: { authMethod: "none" },
            actorId: null,
            ipAddress: null,
            userAgent: null,
          },
        ],
        nextCursor: null,
      },
    });

    render(<AuditLogsClient {...baseProps} />);

    await user.click(screen.getByTestId("trace-drill-in"));

    await waitFor(() => {
      expect(mockFetchAuditLogsAction).toHaveBeenCalledWith(expect.objectContaining({ traceId: "trace-123" }));
    });

    expect(screen.getByLabelText("Trace ID")).toHaveValue("trace-123");
  });
});
