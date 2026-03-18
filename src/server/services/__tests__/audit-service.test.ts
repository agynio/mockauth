/* @vitest-environment node */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { summarizeTokenResponse } from "@/server/services/audit-event";

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

  it("summarizes token responses for audit logs", () => {
    const details = summarizeTokenResponse({
      access_token: "secret",
      refresh_token: "refresh",
      id_token: "id",
      token_type: "Bearer",
      expires_in: 3600,
      scope: "openid",
    });

    expect(details).toMatchObject({
      tokenType: "Bearer",
      scope: "openid",
      expiresIn: 3600,
      hasAccessToken: true,
      hasRefreshToken: true,
      hasIdToken: true,
    });
    expect(details).not.toMatchObject({ access_token: "secret" });
  });

  it("redacts sensitive token data when emitting", async () => {
    const summary = summarizeTokenResponse({
      access_token: "secret",
      refresh_token: "refresh",
      id_token: "id",
      token_type: "Bearer",
      expires_in: 900,
      scope: "openid",
    });

    await emitAuditEvent({
      tenantId: "tenant-1",
      clientId: "client-1",
      eventType: "TOKEN_AUTHCODE_COMPLETED",
      severity: "INFO",
      message: "Token response issued",
      details: summary,
    });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          details: expect.objectContaining({
            tokenType: "Bearer",
            scope: "openid",
            expiresIn: 900,
            hasAccessToken: true,
          }),
        }),
      }),
    );

    const call = mockCreate.mock.calls[0]?.[0]?.data;
    expect(call?.details).not.toHaveProperty("access_token");
    expect(call?.details).not.toHaveProperty("refresh_token");
    expect(call?.details).not.toHaveProperty("id_token");
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
      details: summarizeTokenResponse({
        access_token: "secret",
        token_type: "Bearer",
        expires_in: 900,
      }),
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
