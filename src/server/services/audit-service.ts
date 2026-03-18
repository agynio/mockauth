import { Prisma } from "@/generated/prisma/client";

import { prisma } from "@/server/db/client";
import type { AuditLogSeverity } from "@/lib/audit-log";
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
  severity?: AuditLogSeverity;
  authMethod?: TokenAuthMethod | null;
  clientSecretInBody?: boolean | null;
  expectedAuthMethod?: TokenAuthMethod | null;
  receivedAuthMethod?: TokenAuthMethod | null;
  expectedClientId?: string | null;
  receivedClientId?: string | null;
  expectedRedirectUri?: string | null;
  receivedRedirectUri?: string | null;
  expectedApiResourceId?: string | null;
  receivedApiResourceId?: string | null;
  expectedCodeChallenge?: string | null;
  receivedCodeVerifier?: string | null;
  expectedCodeChallengeMethod?: string | null;
  receivedCodeChallengeMethod?: string | null;
  expectedState?: string | null;
  receivedState?: string | null;
  clientSecret?: string | null;
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
    severity: input.severity ?? "WARN",
    message,
    details: buildSecurityViolationDetails({
      reason: input.reason,
      authMethod: input.authMethod ?? undefined,
      clientSecretInBody: input.clientSecretInBody ?? undefined,
      expectedAuthMethod: input.expectedAuthMethod ?? undefined,
      receivedAuthMethod: input.receivedAuthMethod ?? undefined,
      expectedClientId: input.expectedClientId ?? undefined,
      receivedClientId: input.receivedClientId ?? undefined,
      expectedRedirectUri: input.expectedRedirectUri ?? undefined,
      receivedRedirectUri: input.receivedRedirectUri ?? undefined,
      expectedApiResourceId: input.expectedApiResourceId ?? undefined,
      receivedApiResourceId: input.receivedApiResourceId ?? undefined,
      expectedCodeChallenge: input.expectedCodeChallenge ?? undefined,
      receivedCodeVerifier: input.receivedCodeVerifier ?? undefined,
      expectedCodeChallengeMethod: input.expectedCodeChallengeMethod ?? undefined,
      receivedCodeChallengeMethod: input.receivedCodeChallengeMethod ?? undefined,
      expectedState: input.expectedState ?? undefined,
      receivedState: input.receivedState ?? undefined,
      clientSecret: input.clientSecret,
    }),
    requestContext: input.requestContext ?? undefined,
  });
};
