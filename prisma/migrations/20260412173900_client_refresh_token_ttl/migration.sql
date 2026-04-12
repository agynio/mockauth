-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "refreshTokenTtlSeconds" INTEGER NOT NULL DEFAULT 86400;
