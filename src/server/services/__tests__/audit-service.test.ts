/* @vitest-environment node */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCreate = vi.hoisted(() => vi.fn());

vi.mock("@/server/db/client", () => ({
  prisma: {
    auditLog: {
      create: mockCreate,
    },
  },
}));

import { emitAuditEvent } from "@/server/services/audit-service";

describe("audit-service", () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  it("stores full token responses when emitting", async () => {
    const details = {
      access_token: "secret",
      refresh_token: "refresh",
      id_token: "id",
      token_type: "Bearer",
      expires_in: 900,
      scope: "openid",
    };

    await emitAuditEvent({
      tenantId: "tenant-1",
      clientId: "client-1",
      eventType: "TOKEN_AUTHCODE_COMPLETED",
      severity: "INFO",
      message: "Token response issued",
      details,
    });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          details: expect.objectContaining({
            access_token: "secret",
            refresh_token: "refresh",
            id_token: "id",
            token_type: "Bearer",
            expires_in: 900,
            scope: "openid",
          }),
        }),
      }),
    );
  });

  it("logs audit failures with metadata", async () => {
    const error = new Error("boom");
    mockCreate.mockRejectedValueOnce(error);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await emitAuditEvent({
      tenantId: "tenant-1",
      clientId: "client-1",
      eventType: "TOKEN_AUTHCODE_COMPLETED",
      severity: "INFO",
      message: "Token response issued",
      details: {
        access_token: "secret",
        token_type: "Bearer",
        expires_in: 900,
      },
    });

    expect(errorSpy).toHaveBeenCalledWith(
      "Failed to emit audit event",
      expect.objectContaining({
        message: "boom",
        tenantId: "tenant-1",
        clientId: "client-1",
        eventType: "TOKEN_AUTHCODE_COMPLETED",
        severity: "INFO",
      }),
    );

    errorSpy.mockRestore();
  });
});
