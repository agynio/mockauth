import { Prisma } from "@/generated/prisma/client";

import { prisma } from "@/server/db/client";
import type { RequestContext } from "@/server/utils/request-context";
import {
  buildSecurityViolationDetails,
  sanitizeAuditDetails,
  type AuditEventInput,
  type SecurityViolationReason,
  type TokenAuthMethod,
} from "@/server/services/audit-event";

type SecurityViolationInput = {
  tenantId: string;
  clientId?: string | null;
  traceId?: string | null;
  reason: SecurityViolationReason;
  authMethod?: TokenAuthMethod | null;
  clientSecretInBody?: boolean | null;
  requestContext?: RequestContext | null;
  message?: string;
};

export const emitAuditEvent = async (input: AuditEventInput) => {
  const sanitizedDetails = sanitizeAuditDetails(input);

  try {
    await prisma.auditLog.create({
      data: {
        tenantId: input.tenantId,
        clientId: input.clientId ?? null,
        traceId: input.traceId ?? null,
        actorId: input.actorId ?? null,
        eventType: input.eventType,
        severity: input.severity,
        message: input.message,
        details: sanitizedDetails ?? Prisma.JsonNull,
        ipAddress: input.requestContext?.ipAddress ?? null,
        userAgent: input.requestContext?.userAgent ?? null,
      },
    });
  } catch (error) {
    const errorPayload =
      error instanceof Error
        ? { name: error.name, message: error.message, stack: error.stack }
        : { error: String(error) };
    console.error("Failed to emit audit event", {
      ...errorPayload,
      tenantId: input.tenantId,
      clientId: input.clientId ?? null,
      traceId: input.traceId ?? null,
      eventType: input.eventType,
      severity: input.severity,
    });
  }
};

export const recordSecurityViolation = async (input: SecurityViolationInput) => {
  const message = input.message ?? `Security violation: ${input.reason}`;
  await emitAuditEvent({
    tenantId: input.tenantId,
    clientId: input.clientId ?? null,
    traceId: input.traceId ?? null,
    actorId: null,
    eventType: "SECURITY_VIOLATION",
    severity: "WARN",
    message,
    details: buildSecurityViolationDetails({
      reason: input.reason,
      authMethod: input.authMethod ?? undefined,
      clientSecretInBody: input.clientSecretInBody ?? undefined,
    }),
    requestContext: input.requestContext ?? undefined,
  });
};
