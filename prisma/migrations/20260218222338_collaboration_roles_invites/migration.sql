/*
  Warnings:

  - The values [ADMIN,MEMBER] on the enum `MembershipRole` will be removed. Existing rows are remapped to the new
    equivalents (ADMIN→WRITER, MEMBER→READER) during this migration.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "MembershipRole_new" AS ENUM ('OWNER', 'WRITER', 'READER');
ALTER TABLE "public"."TenantMembership" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "TenantMembership"
  ALTER COLUMN "role"
  TYPE "MembershipRole_new"
  USING (
    CASE
      WHEN "role"::text = 'ADMIN' THEN 'WRITER'
      WHEN "role"::text = 'MEMBER' THEN 'READER'
      ELSE "role"::text
    END
  ::"MembershipRole_new");
ALTER TYPE "MembershipRole" RENAME TO "MembershipRole_old";
ALTER TYPE "MembershipRole_new" RENAME TO "MembershipRole";
DROP TYPE "public"."MembershipRole_old";
ALTER TABLE "TenantMembership" ALTER COLUMN "role" SET DEFAULT 'READER';
COMMIT;

-- AlterTable
ALTER TABLE "TenantMembership"
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "role" SET DEFAULT 'READER';

ALTER TABLE "TenantMembership"
  ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateTable
CREATE TABLE "Invite" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "role" "MembershipRole" NOT NULL DEFAULT 'READER',
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "usedByUserId" TEXT,
    "revokedAt" TIMESTAMP(3),
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Invite_tokenHash_key" ON "Invite"("tokenHash");

-- CreateIndex
CREATE INDEX "Invite_tenantId_idx" ON "Invite"("tenantId");

-- AddForeignKey
ALTER TABLE "Invite" ADD CONSTRAINT "Invite_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invite" ADD CONSTRAINT "Invite_usedByUserId_fkey" FOREIGN KEY ("usedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invite" ADD CONSTRAINT "Invite_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
