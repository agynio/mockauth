/*
  Warnings:

  - Added the required column `loginStrategy` to the `AuthorizationCode` table without a default value. This is not possible if the table is not empty.
  - Added the required column `subject` to the `AuthorizationCode` table without a default value. This is not possible if the table is not empty.
  - Added the required column `loginStrategy` to the `MockSession` table without a default value. This is not possible if the table is not empty.
  - Added the required column `subject` to the `MockSession` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "LoginStrategy" AS ENUM ('USERNAME', 'EMAIL');

-- AlterTable
ALTER TABLE "AuthorizationCode" ADD COLUMN     "loginStrategy" "LoginStrategy",
ADD COLUMN     "subject" TEXT;

UPDATE "AuthorizationCode" SET "loginStrategy" = 'USERNAME', "subject" = "userId" WHERE "loginStrategy" IS NULL;

ALTER TABLE "AuthorizationCode" ALTER COLUMN "loginStrategy" SET NOT NULL;
ALTER TABLE "AuthorizationCode" ALTER COLUMN "subject" SET NOT NULL;

-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "authStrategies" JSONB NOT NULL DEFAULT '{"username":{"enabled":true,"subSource":"entered"},"email":{"enabled":false,"subSource":"entered"}}';

-- AlterTable
ALTER TABLE "MockSession" ADD COLUMN     "loginStrategy" "LoginStrategy",
ADD COLUMN     "subject" TEXT;

UPDATE "MockSession" SET "loginStrategy" = 'USERNAME', "subject" = "userId" WHERE "loginStrategy" IS NULL;

ALTER TABLE "MockSession" ALTER COLUMN "loginStrategy" SET NOT NULL;
ALTER TABLE "MockSession" ALTER COLUMN "subject" SET NOT NULL;
