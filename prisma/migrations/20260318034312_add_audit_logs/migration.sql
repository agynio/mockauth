-- CreateEnum
CREATE TYPE "AuditLogEventType" AS ENUM ('AUTHORIZE_RECEIVED', 'PROXY_REDIRECT_OUT', 'PROXY_CALLBACK_SUCCESS', 'PROXY_CALLBACK_ERROR', 'PROXY_CODE_ISSUED', 'TOKEN_AUTHCODE_RECEIVED', 'TOKEN_AUTHCODE_COMPLETED', 'TOKEN_REFRESH_RECEIVED', 'TOKEN_REFRESH_COMPLETED', 'CONFIG_CHANGED', 'SECURITY_VIOLATION');

-- CreateEnum
CREATE TYPE "AuditLogSeverity" AS ENUM ('INFO', 'WARN', 'ERROR');

-- AlterTable
ALTER TABLE "AuthorizationCode" ADD COLUMN     "traceId" TEXT;

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "clientId" TEXT,
    "traceId" TEXT,
    "eventType" "AuditLogEventType" NOT NULL,
    "severity" "AuditLogSeverity" NOT NULL,
    "message" TEXT NOT NULL,
    "details" JSONB,
    "actorId" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuditLog_tenantId_createdAt_idx" ON "AuditLog"("tenantId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "AuditLog_tenantId_clientId_createdAt_idx" ON "AuditLog"("tenantId", "clientId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "AuditLog_tenantId_traceId_idx" ON "AuditLog"("tenantId", "traceId");

-- CreateIndex
CREATE INDEX "AuditLog_tenantId_eventType_createdAt_idx" ON "AuditLog"("tenantId", "eventType", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;
