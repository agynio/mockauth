-- Existing OAuth test sessions are ephemeral; remove them so we can add the
-- non-nullable admin reference without backfilling.
DELETE FROM "OAuthTestSession";

-- AlterTable
ALTER TABLE "OAuthTestSession" ADD COLUMN     "adminUserId" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "OAuthTestSession_clientId_adminUserId_idx" ON "OAuthTestSession"("clientId", "adminUserId");

-- AddForeignKey
ALTER TABLE "OAuthTestSession" ADD CONSTRAINT "OAuthTestSession_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
