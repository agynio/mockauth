-- CreateEnum
CREATE TYPE "JwtSigningAlg" AS ENUM ('RS256', 'PS256', 'ES256', 'ES384');

-- DropIndex
DROP INDEX "TenantKey_tenantId_status_idx";

-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "accessTokenSigningAlg" "JwtSigningAlg",
ADD COLUMN     "idTokenSignedResponseAlg" "JwtSigningAlg";

-- AlterTable
ALTER TABLE "TenantKey"
    ALTER COLUMN "alg" TYPE "JwtSigningAlg" USING ("alg"::"JwtSigningAlg"),
    ALTER COLUMN "alg" SET DEFAULT 'RS256';

-- CreateIndex
CREATE INDEX "TenantKey_tenantId_alg_status_idx" ON "TenantKey"("tenantId", "alg", "status");
