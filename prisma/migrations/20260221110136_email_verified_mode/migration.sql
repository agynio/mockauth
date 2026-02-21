-- AlterTable
ALTER TABLE "AuthorizationCode" ADD COLUMN     "emailVerifiedOverride" BOOLEAN;

-- AlterTable
ALTER TABLE "Client" ALTER COLUMN "authStrategies" SET DEFAULT '{"username":{"enabled":true,"subSource":"entered"},"email":{"enabled":false,"subSource":"entered","emailVerifiedMode":"false"}}';

-- Backfill missing emailVerifiedMode on existing client auth strategies
UPDATE "Client"
SET "authStrategies" = jsonb_set(
  COALESCE("authStrategies", '{}'::jsonb),
  '{email,emailVerifiedMode}',
  to_jsonb(COALESCE(("authStrategies"->'email'->>'emailVerifiedMode'), 'false')),
  true
)
WHERE ("authStrategies"->'email'->>'emailVerifiedMode') IS NULL;

-- AlterTable
ALTER TABLE "MockSession" ADD COLUMN     "emailVerifiedOverride" BOOLEAN;
