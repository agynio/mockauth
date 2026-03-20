-- CreateEnum
CREATE TYPE "AuditLogEventType" AS ENUM ('AUTHORIZE_RECEIVED', 'PROXY_REDIRECT_OUT', 'PROXY_CALLBACK_SUCCESS', 'PROXY_CALLBACK_ERROR', 'PROXY_CODE_ISSUED', 'TOKEN_AUTHCODE_RECEIVED', 'TOKEN_AUTHCODE_COMPLETED', 'TOKEN_REFRESH_RECEIVED', 'TOKEN_REFRESH_COMPLETED', 'CONFIG_CHANGED', 'SECURITY_VIOLATION');

-- CreateEnum
CREATE TYPE "AuditLogSeverity" AS ENUM ('INFO', 'WARN', 'ERROR');

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "clientId" TEXT,
    "traceId" TEXT,
    "actorId" TEXT,
    "eventType" "AuditLogEventType" NOT NULL,
    "severity" "AuditLogSeverity" NOT NULL,
    "message" TEXT NOT NULL,
    "details" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);
