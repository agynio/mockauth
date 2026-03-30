-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.

ALTER TYPE "AuditLogEventType" ADD VALUE 'PREAUTHORIZED_IDENTITY_SELECTED';
ALTER TYPE "AuditLogEventType" ADD VALUE 'PREAUTHORIZED_IDENTITY_DELETED';
ALTER TYPE "AuditLogEventType" ADD VALUE 'PREAUTHORIZED_TOKEN_REFRESH_SUCCESS';
ALTER TYPE "AuditLogEventType" ADD VALUE 'PREAUTHORIZED_TOKEN_REFRESH_FAILED';

-- Delete invalid identities missing a provider subject
DELETE FROM "PreauthorizedIdentity" WHERE "providerSubject" IS NULL;

-- AlterTable
ALTER TABLE "PreauthorizedIdentity" ALTER COLUMN "providerSubject" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "PreauthorizedIdentity_clientId_providerSubject_key" ON "PreauthorizedIdentity"("clientId", "providerSubject");
