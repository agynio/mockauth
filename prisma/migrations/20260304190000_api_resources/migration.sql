-- AlterTable
ALTER TABLE "AccessToken" ADD COLUMN     "apiResourceId" TEXT;

-- AlterTable
ALTER TABLE "AuthorizationCode" ADD COLUMN     "apiResourceId" TEXT;

-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "apiResourceId" TEXT;

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "defaultApiResourceId" TEXT;

-- CreateTable
CREATE TABLE "ApiResource" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApiResource_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ApiResource_tenantId_name_key" ON "ApiResource"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_defaultApiResourceId_key" ON "Tenant"("defaultApiResourceId");

-- Seed default API resources for existing tenants
INSERT INTO "ApiResource" ("id", "tenantId", "name", "createdAt", "updatedAt")
SELECT t."id" || '_default_resource', t."id", t."name" || ' default', NOW(), NOW()
FROM "Tenant" t
ON CONFLICT DO NOTHING;

UPDATE "Tenant" t
SET "defaultApiResourceId" = t."id" || '_default_resource'
WHERE t."defaultApiResourceId" IS NULL;

UPDATE "Client" c
SET "apiResourceId" = t."defaultApiResourceId"
FROM "Tenant" t
WHERE c."tenantId" = t."id" AND t."defaultApiResourceId" IS NOT NULL AND c."apiResourceId" IS NULL;

UPDATE "AuthorizationCode" ac
SET "apiResourceId" = t."defaultApiResourceId"
FROM "Tenant" t
WHERE ac."tenantId" = t."id" AND t."defaultApiResourceId" IS NOT NULL AND ac."apiResourceId" IS NULL;

UPDATE "AccessToken" at
SET "apiResourceId" = t."defaultApiResourceId"
FROM "Tenant" t
WHERE at."tenantId" = t."id" AND t."defaultApiResourceId" IS NOT NULL AND at."apiResourceId" IS NULL;

-- Enforce non-null apiResourceId for issued records
ALTER TABLE "AuthorizationCode" ALTER COLUMN "apiResourceId" SET NOT NULL;
ALTER TABLE "AccessToken" ALTER COLUMN "apiResourceId" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "Tenant" ADD CONSTRAINT "Tenant_defaultApiResourceId_fkey" FOREIGN KEY ("defaultApiResourceId") REFERENCES "ApiResource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiResource" ADD CONSTRAINT "ApiResource_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_apiResourceId_fkey" FOREIGN KEY ("apiResourceId") REFERENCES "ApiResource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthorizationCode" ADD CONSTRAINT "AuthorizationCode_apiResourceId_fkey" FOREIGN KEY ("apiResourceId") REFERENCES "ApiResource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessToken" ADD CONSTRAINT "AccessToken_apiResourceId_fkey" FOREIGN KEY ("apiResourceId") REFERENCES "ApiResource"("id") ON DELETE CASCADE ON UPDATE CASCADE;
