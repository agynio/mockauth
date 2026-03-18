import { DomainError } from "@/server/errors";
import { recordSecurityViolation } from "@/server/services/audit-service";
import type { RequestContext } from "@/server/utils/request-context";
import type { AuditLogSeverity } from "@/lib/audit-log";
import type { SecurityViolationDetails, SecurityViolationReason, TokenAuthMethod } from "@/server/services/audit-event";

export type SecurityViolationContext = {
  tenantId: string;
  clientId?: string | null;
  traceId?: string | null;
  severity?: AuditLogSeverity;
  authMethod?: TokenAuthMethod | null;
  clientSecretInBody?: boolean | null;
  requestContext?: RequestContext | null;
};

type SecurityViolationDetailOverrides = Omit<
  SecurityViolationDetails,
  "reason" | "authMethod" | "clientSecretInBody"
>;

export class SecurityViolationError extends DomainError {
  public readonly details?: SecurityViolationDetailOverrides;

  constructor(
    message: string,
    options: { status?: number; code?: string },
    public readonly reason: SecurityViolationReason,
    details?: SecurityViolationDetailOverrides,
  ) {
    super(message, options);
    this.name = "SecurityViolationError";
    this.details = details;
  }
}

type SecurityViolationReporter = {
  (reason: SecurityViolationReason, message?: string): Promise<void>;
  (reason: SecurityViolationReason, details: SecurityViolationDetailOverrides, message?: string): Promise<void>;
};

export const createSecurityViolationReporter = (context: SecurityViolationContext): SecurityViolationReporter => {
  return async (
    reason: SecurityViolationReason,
    detailsOrMessage?: SecurityViolationDetailOverrides | string,
    message?: string,
  ) => {
    const details = typeof detailsOrMessage === "string" || detailsOrMessage === undefined ? undefined : detailsOrMessage;
    const resolvedMessage = typeof detailsOrMessage === "string" ? detailsOrMessage : message;
    await recordSecurityViolation({
      ...context,
      reason,
      message: resolvedMessage,
      ...details,
    });
  };
};

export const withSecurityViolationAudit = async <T>(
  fn: () => Promise<T>,
  context: SecurityViolationContext,
): Promise<T> => {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof SecurityViolationError) {
      await recordSecurityViolation({
        ...context,
        reason: error.reason,
        message: error.message,
        ...error.details,
      });
    }
    throw error;
  }
};
