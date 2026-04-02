/*
  Warnings:

  - The values [preauthorized] on the enum `OAuthClientMode` will be removed. If these variants are still used in the database, this will fail.

*/
-- CreateEnum
CREATE TYPE "ProxyAuthStrategy" AS ENUM ('redirect', 'preauthorized');

-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "proxyAuthStrategy" "ProxyAuthStrategy";

-- Data migration
UPDATE "Client" SET "proxyAuthStrategy" = 'redirect' WHERE "oauthClientMode" = 'proxy';
UPDATE "Client" SET "proxyAuthStrategy" = 'preauthorized', "oauthClientMode" = 'proxy'
WHERE "oauthClientMode" = 'preauthorized';

-- AlterEnum
BEGIN;
CREATE TYPE "OAuthClientMode_new" AS ENUM ('regular', 'proxy');
ALTER TABLE "public"."Client" ALTER COLUMN "oauthClientMode" DROP DEFAULT;
ALTER TABLE "Client" ALTER COLUMN "oauthClientMode" TYPE "OAuthClientMode_new" USING ("oauthClientMode"::text::"OAuthClientMode_new");
ALTER TYPE "OAuthClientMode" RENAME TO "OAuthClientMode_old";
ALTER TYPE "OAuthClientMode_new" RENAME TO "OAuthClientMode";
DROP TYPE "public"."OAuthClientMode_old";
ALTER TABLE "Client" ALTER COLUMN "oauthClientMode" SET DEFAULT 'regular';
COMMIT;
