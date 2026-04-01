-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditLogEventType" ADD VALUE 'PREAUTHORIZED_ADMIN_REDIRECT_OUT';
ALTER TYPE "AuditLogEventType" ADD VALUE 'PREAUTHORIZED_ADMIN_CALLBACK_SUCCESS';
ALTER TYPE "AuditLogEventType" ADD VALUE 'PREAUTHORIZED_ADMIN_CALLBACK_ERROR';
ALTER TYPE "AuditLogEventType" ADD VALUE 'PREAUTHORIZED_CODE_ISSUED';
ALTER TYPE "AuditLogEventType" ADD VALUE 'PREAUTHORIZED_IDENTITY_SELECTED';
ALTER TYPE "AuditLogEventType" ADD VALUE 'PREAUTHORIZED_IDENTITY_DELETED';
ALTER TYPE "AuditLogEventType" ADD VALUE 'PREAUTHORIZED_TOKEN_REFRESH_SUCCESS';
ALTER TYPE "AuditLogEventType" ADD VALUE 'PREAUTHORIZED_TOKEN_REFRESH_FAILED';

-- AlterEnum
ALTER TYPE "OAuthClientMode" ADD VALUE 'preauthorized';

-- AlterTable
ALTER TABLE "ProxyTokenExchange" ADD COLUMN     "providerScope" TEXT;

-- CreateTable
CREATE TABLE "PreauthorizedIdentity" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "label" TEXT,
    "providerSubject" TEXT NOT NULL,
    "providerEmail" TEXT,
    "providerScope" TEXT NOT NULL,
    "providerResponseEncrypted" TEXT NOT NULL,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PreauthorizedIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminAuthTransaction" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "adminUserId" TEXT NOT NULL,
    "redirectUri" TEXT NOT NULL,
    "providerScope" TEXT NOT NULL,
    "providerCodeVerifier" TEXT,
    "providerPkceEnabled" BOOLEAN NOT NULL DEFAULT false,
    "identityLabel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminAuthTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PickerTransaction" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "apiResourceId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "redirectUri" TEXT NOT NULL,
    "appState" TEXT,
    "appNonce" TEXT,
    "appScope" TEXT NOT NULL,
    "appCodeChallenge" TEXT NOT NULL,
    "appCodeChallengeMethod" TEXT NOT NULL DEFAULT 'S256',
    "loginHint" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),

    CONSTRAINT "PickerTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PreauthorizedIdentity_tenantId_clientId_idx" ON "PreauthorizedIdentity"("tenantId", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "PreauthorizedIdentity_clientId_providerSubject_key" ON "PreauthorizedIdentity"("clientId", "providerSubject");

-- CreateIndex
CREATE INDEX "AdminAuthTransaction_tenantId_clientId_idx" ON "AdminAuthTransaction"("tenantId", "clientId");

-- CreateIndex
CREATE INDEX "AdminAuthTransaction_expiresAt_idx" ON "AdminAuthTransaction"("expiresAt");

-- CreateIndex
CREATE INDEX "PickerTransaction_tenantId_clientId_idx" ON "PickerTransaction"("tenantId", "clientId");

-- CreateIndex
CREATE INDEX "PickerTransaction_expiresAt_idx" ON "PickerTransaction"("expiresAt");

-- AddForeignKey
ALTER TABLE "PreauthorizedIdentity" ADD CONSTRAINT "PreauthorizedIdentity_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreauthorizedIdentity" ADD CONSTRAINT "PreauthorizedIdentity_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminAuthTransaction" ADD CONSTRAINT "AdminAuthTransaction_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminAuthTransaction" ADD CONSTRAINT "AdminAuthTransaction_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminAuthTransaction" ADD CONSTRAINT "AdminAuthTransaction_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PickerTransaction" ADD CONSTRAINT "PickerTransaction_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PickerTransaction" ADD CONSTRAINT "PickerTransaction_apiResourceId_fkey" FOREIGN KEY ("apiResourceId") REFERENCES "ApiResource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PickerTransaction" ADD CONSTRAINT "PickerTransaction_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
