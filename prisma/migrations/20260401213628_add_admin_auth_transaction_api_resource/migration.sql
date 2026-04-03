-- Step 1: Add column as nullable
ALTER TABLE "AdminAuthTransaction" ADD COLUMN "apiResourceId" TEXT;

-- Step 2: Backfill existing rows using the client's apiResourceId,
-- falling back to the tenant's defaultApiResourceId.
UPDATE "AdminAuthTransaction" AS aat
SET "apiResourceId" = COALESCE(c."apiResourceId", t."defaultApiResourceId")
FROM "Client" AS c
JOIN "Tenant" AS t ON t."id" = c."tenantId"
WHERE c."id" = aat."clientId";

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "AdminAuthTransaction" WHERE "apiResourceId" IS NULL) THEN
    RAISE EXCEPTION 'Backfill incomplete: AdminAuthTransaction rows with NULL apiResourceId';
  END IF;
END $$;

-- Step 3: Set NOT NULL constraint (safe now that all rows have a value)
ALTER TABLE "AdminAuthTransaction" ALTER COLUMN "apiResourceId" SET NOT NULL;

-- Step 4: Add foreign key
ALTER TABLE "AdminAuthTransaction" ADD CONSTRAINT "AdminAuthTransaction_apiResourceId_fkey"
  FOREIGN KEY ("apiResourceId") REFERENCES "ApiResource"("id") ON DELETE CASCADE ON UPDATE CASCADE;
