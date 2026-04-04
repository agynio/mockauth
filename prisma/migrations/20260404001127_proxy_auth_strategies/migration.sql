/*
  Warnings:

  - You are about to drop the column `proxyAuthStrategy` on the `Client` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "proxyAuthStrategies" JSONB;

-- Backfill
UPDATE "Client"
SET "proxyAuthStrategies" = CASE
  WHEN "proxyAuthStrategy" = 'redirect'
    THEN '{"redirect":{"enabled":true},"preauthorized":{"enabled":false}}'::jsonb
  WHEN "proxyAuthStrategy" = 'preauthorized'
    THEN '{"redirect":{"enabled":false},"preauthorized":{"enabled":true}}'::jsonb
  ELSE NULL
END;

-- AlterTable
ALTER TABLE "Client" DROP COLUMN "proxyAuthStrategy";

-- DropEnum
DROP TYPE "ProxyAuthStrategy";
