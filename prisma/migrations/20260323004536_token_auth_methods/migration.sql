-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "tokenEndpointAuthMethods" TEXT[] NOT NULL DEFAULT ARRAY['client_secret_basic']::text[];

-- Data migration
UPDATE "Client" SET "tokenEndpointAuthMethods" = ARRAY["tokenEndpointAuthMethod"]::text[];

-- AlterTable
ALTER TABLE "ProxyProviderConfig" ALTER COLUMN "upstreamTokenEndpointAuthMethod" TYPE TEXT USING "upstreamTokenEndpointAuthMethod"::text;
ALTER TABLE "ProxyProviderConfig" ALTER COLUMN "upstreamTokenEndpointAuthMethod" SET DEFAULT 'client_secret_basic';

-- AlterTable
ALTER TABLE "Client" DROP COLUMN "clientType";
ALTER TABLE "Client" DROP COLUMN "tokenEndpointAuthMethod";

-- DropEnum
DROP TYPE "ClientType";
DROP TYPE "TokenEndpointAuthMethod";
