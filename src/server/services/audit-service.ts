import { Prisma } from "@/generated/prisma/client";
import type { AuditLogEventType, AuditLogSeverity } from "@/generated/prisma/client";

import { prisma } from "@/server/db/client";
import type { RequestContext } from "@/server/utils/request-context";

export type AuditEventInput = {
  tenantId: string;
  clientId?: string | null;
  traceId?: string | null;
  actorId?: string | null;
  eventType: AuditLogEventType;
  severity: AuditLogSeverity;
  message: string;
  details?: Record<string, unknown> | null;
  requestContext?: RequestContext | null;
};

type SecurityViolationInput = {
  tenantId: string;
  clientId?: string | null;
  traceId?: string | null;
  reason: string;
  authMethod?: string | null;
  clientSecretInBody?: boolean | null;
  requestContext?: RequestContext | null;
  message?: string;
};

const asString = (value: unknown) => (typeof value === "string" && value.trim() ? value : undefined);
const asBoolean = (value: unknown) => (typeof value === "boolean" ? value : undefined);
const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
};

const compactDetails = (value: Record<string, unknown>): Prisma.InputJsonObject | null => {
  const entries = Object.entries(value).filter(([, entry]) => entry !== undefined);
  return entries.length > 0 ? (Object.fromEntries(entries) as Prisma.InputJsonObject) : null;
};

const summarizeTokenResponse = (response: Record<string, unknown>): Prisma.InputJsonObject | null => {
  const expiresInRaw = response.expires_in;
  const expiresIn =
    typeof expiresInRaw === "number"
      ? expiresInRaw
      : typeof expiresInRaw === "string" && expiresInRaw.trim()
        ? Number(expiresInRaw)
        : undefined;

  return compactDetails({
    tokenType: asString(response.token_type),
    scope: asString(response.scope),
    expiresIn: Number.isFinite(expiresIn ?? Number.NaN) ? expiresIn : undefined,
    hasAccessToken: typeof response.access_token === "string",
    hasRefreshToken: typeof response.refresh_token === "string",
    hasIdToken: typeof response.id_token === "string",
  });
};

const parseUrlHost = (value: unknown) => {
  const raw = asString(value);
  if (!raw) {
    return undefined;
  }
  try {
    return new URL(raw).host;
  } catch {
    return undefined;
  }
};

export const sanitizeAuditDetails = (
  eventType: AuditLogEventType,
  details?: Record<string, unknown> | null,
): Prisma.InputJsonValue | null => {
  const source = details ?? {};

  switch (eventType) {
    case "AUTHORIZE_RECEIVED":
      return compactDetails({
        responseType: asString(source.responseType),
        scope: asString(source.scope),
        prompt: asString(source.prompt),
        codeChallengeMethod: asString(source.codeChallengeMethod),
        loginHintProvided: asBoolean(source.loginHintProvided),
        nonceProvided: asBoolean(source.nonceProvided),
        freshLoginRequested: asBoolean(source.freshLoginRequested),
      });
    case "PROXY_REDIRECT_OUT":
      return compactDetails({
        providerType: asString(source.providerType),
        providerScope: asString(source.providerScope),
        providerPkceEnabled: asBoolean(source.providerPkceEnabled),
        prompt: asString(source.prompt),
        loginHintProvided: asBoolean(source.loginHintProvided),
      });
    case "PROXY_CALLBACK_SUCCESS": {
      const response = isRecord(source.providerResponse) ? source.providerResponse : source;
      const summary = summarizeTokenResponse(response);
      return compactDetails({
        providerType: asString(source.providerType),
        ...(summary ?? {}),
      });
    }
    case "PROXY_CALLBACK_ERROR":
      return compactDetails({
        error: asString(source.error),
        errorDescription: asString(source.errorDescription),
        providerType: asString(source.providerType),
      });
    case "PROXY_CODE_ISSUED":
      return compactDetails({
        scope: asString(source.scope),
        redirectUriHost: parseUrlHost(source.redirectUri),
      });
    case "TOKEN_AUTHCODE_RECEIVED":
      return compactDetails({
        authMethod: asString(source.authMethod),
        clientSecretInBody: asBoolean(source.clientSecretInBody),
        clientIdProvided: asBoolean(source.clientIdProvided),
      });
    case "TOKEN_AUTHCODE_COMPLETED":
      return summarizeTokenResponse(isRecord(source) ? source : {});
    case "TOKEN_REFRESH_RECEIVED":
      return compactDetails({
        authMethod: asString(source.authMethod),
        clientSecretInBody: asBoolean(source.clientSecretInBody),
        scope: asString(source.scope),
      });
    case "TOKEN_REFRESH_COMPLETED":
      return summarizeTokenResponse(isRecord(source) ? source : {});
    case "CONFIG_CHANGED":
      return compactDetails({
        action: asString(source.action),
        resource: asString(source.resource),
        resourceId: asString(source.resourceId),
        resourceName: asString(source.resourceName),
      });
    case "SECURITY_VIOLATION":
      return compactDetails({
        reason: asString(source.reason),
        authMethod: asString(source.authMethod),
        clientSecretInBody: asBoolean(source.clientSecretInBody),
      });
    default:
      return null;
  }
};

export const emitAuditEvent = async (input: AuditEventInput) => {
  const auditClient = (prisma as typeof prisma & { auditLog?: { create?: (args: { data: Prisma.AuditLogCreateInput }) => Promise<unknown> } })
    .auditLog;
  if (!auditClient?.create) {
    return;
  }

  const sanitizedDetails = sanitizeAuditDetails(input.eventType, input.details ?? undefined);

  try {
    await auditClient.create({
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
    console.error("Failed to emit audit event", error);
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
    details: {
      reason: input.reason,
      authMethod: input.authMethod ?? undefined,
      clientSecretInBody: input.clientSecretInBody ?? undefined,
    },
    requestContext: input.requestContext ?? undefined,
  });
};

export const summarizeAuditTokenResponse = summarizeTokenResponse;
