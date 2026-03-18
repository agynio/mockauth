import type { RequestContext } from "@/server/utils/request-context";
import { DomainError } from "@/server/errors";
import { recordSecurityViolation } from "@/server/services/audit-service";
import type { SecurityViolationReason, TokenAuthMethod } from "@/server/services/audit-event";

export type SecurityViolationContext = {
  tenantId: string;
  clientId?: string | null;
  traceId?: string | null;
  authMethod?: TokenAuthMethod | null;
  clientSecretInBody?: boolean | null;
  requestContext?: RequestContext | null;
};

export class SecurityViolationError extends DomainError {
  constructor(
    message: string,
    options: { status?: number; code?: string },
    public readonly reason: SecurityViolationReason,
  ) {
    super(message, options);
    this.name = "SecurityViolationError";
  }
}

export const createSecurityViolationReporter = (context: SecurityViolationContext) => {
  return async (reason: SecurityViolationReason, message?: string) => {
    await recordSecurityViolation({
      ...context,
      reason,
      message,
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
      });
    }
    throw error;
  }
};
