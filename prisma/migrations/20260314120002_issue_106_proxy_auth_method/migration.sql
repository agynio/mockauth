-- AlterTable
ALTER TABLE "ProxyProviderConfig" ADD COLUMN     "upstreamTokenEndpointAuthMethod" "TokenEndpointAuthMethod" NOT NULL DEFAULT 'client_secret_basic';
