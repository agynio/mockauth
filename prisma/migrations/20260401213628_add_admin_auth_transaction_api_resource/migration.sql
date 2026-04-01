/*
  Warnings:

  - Added the required column `apiResourceId` to the `AdminAuthTransaction` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "AdminAuthTransaction" ADD COLUMN     "apiResourceId" TEXT NOT NULL;

-- AddForeignKey
ALTER TABLE "AdminAuthTransaction" ADD CONSTRAINT "AdminAuthTransaction_apiResourceId_fkey" FOREIGN KEY ("apiResourceId") REFERENCES "ApiResource"("id") ON DELETE CASCADE ON UPDATE CASCADE;
