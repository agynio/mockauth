-- Empty anchor migration before issue_106

-- CreateEnum
CREATE TYPE "OAuthClientMode" AS ENUM ('regular', 'proxy');

-- CreateEnum
CREATE TYPE "ProxyProviderType" AS ENUM ('oidc', 'oauth2');

-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "oauthClientMode" "OAuthClientMode" NOT NULL DEFAULT 'regular';

-- CreateTable
CREATE TABLE "ProxyProviderConfig" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "providerType" "ProxyProviderType" NOT NULL,
    "authorizationEndpoint" TEXT NOT NULL,
    "tokenEndpoint" TEXT NOT NULL,
    "userinfoEndpoint" TEXT,
    "jwksUri" TEXT,
    "upstreamClientId" TEXT NOT NULL,
    "upstreamClientSecretEncrypted" TEXT,
    "defaultScopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "scopeMapping" JSONB,
    "pkceSupported" BOOLEAN NOT NULL DEFAULT false,
    "oidcEnabled" BOOLEAN NOT NULL DEFAULT false,
    "promptPassthroughEnabled" BOOLEAN NOT NULL DEFAULT false,
    "loginHintPassthroughEnabled" BOOLEAN NOT NULL DEFAULT false,
    "passthroughTokenResponse" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProxyProviderConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProxyAuthTransaction" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "apiResourceId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "redirectUri" TEXT NOT NULL,
    "appState" TEXT,
    "appNonce" TEXT,
    "appScope" TEXT NOT NULL,
    "appCodeChallenge" TEXT NOT NULL,
    "appCodeChallengeMethod" TEXT NOT NULL DEFAULT 'S256',
    "providerScope" TEXT NOT NULL,
    "providerCodeVerifier" TEXT,
    "providerPkceEnabled" BOOLEAN NOT NULL DEFAULT false,
    "prompt" TEXT,
    "loginHint" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProxyAuthTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProxyTokenExchange" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "apiResourceId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "transactionId" TEXT,
    "providerResponseEncrypted" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),

    CONSTRAINT "ProxyTokenExchange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProxyAuthorizationCode" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "apiResourceId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "redirectUri" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "nonce" TEXT,
    "state" TEXT,
    "codeChallenge" TEXT NOT NULL,
    "codeChallengeMethod" TEXT NOT NULL DEFAULT 'S256',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tokenExchangeId" TEXT NOT NULL,

    CONSTRAINT "ProxyAuthorizationCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProxyProviderConfig_clientId_key" ON "ProxyProviderConfig"("clientId");

-- CreateIndex
CREATE INDEX "ProxyAuthTransaction_tenantId_clientId_idx" ON "ProxyAuthTransaction"("tenantId", "clientId");

-- CreateIndex
CREATE INDEX "ProxyAuthTransaction_expiresAt_idx" ON "ProxyAuthTransaction"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProxyTokenExchange_transactionId_key" ON "ProxyTokenExchange"("transactionId");

-- CreateIndex
CREATE INDEX "ProxyTokenExchange_tenantId_clientId_idx" ON "ProxyTokenExchange"("tenantId", "clientId");

-- CreateIndex
CREATE INDEX "ProxyTokenExchange_expiresAt_idx" ON "ProxyTokenExchange"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProxyAuthorizationCode_codeHash_key" ON "ProxyAuthorizationCode"("codeHash");

-- CreateIndex
CREATE UNIQUE INDEX "ProxyAuthorizationCode_tokenExchangeId_key" ON "ProxyAuthorizationCode"("tokenExchangeId");

-- CreateIndex
CREATE INDEX "ProxyAuthorizationCode_tenantId_clientId_idx" ON "ProxyAuthorizationCode"("tenantId", "clientId");

-- CreateIndex
CREATE INDEX "ProxyAuthorizationCode_expiresAt_idx" ON "ProxyAuthorizationCode"("expiresAt");

-- AddForeignKey
ALTER TABLE "ProxyProviderConfig" ADD CONSTRAINT "ProxyProviderConfig_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProxyAuthTransaction" ADD CONSTRAINT "ProxyAuthTransaction_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProxyAuthTransaction" ADD CONSTRAINT "ProxyAuthTransaction_apiResourceId_fkey" FOREIGN KEY ("apiResourceId") REFERENCES "ApiResource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProxyAuthTransaction" ADD CONSTRAINT "ProxyAuthTransaction_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProxyTokenExchange" ADD CONSTRAINT "ProxyTokenExchange_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProxyTokenExchange" ADD CONSTRAINT "ProxyTokenExchange_apiResourceId_fkey" FOREIGN KEY ("apiResourceId") REFERENCES "ApiResource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProxyTokenExchange" ADD CONSTRAINT "ProxyTokenExchange_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProxyTokenExchange" ADD CONSTRAINT "ProxyTokenExchange_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "ProxyAuthTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProxyAuthorizationCode" ADD CONSTRAINT "ProxyAuthorizationCode_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProxyAuthorizationCode" ADD CONSTRAINT "ProxyAuthorizationCode_apiResourceId_fkey" FOREIGN KEY ("apiResourceId") REFERENCES "ApiResource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProxyAuthorizationCode" ADD CONSTRAINT "ProxyAuthorizationCode_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProxyAuthorizationCode" ADD CONSTRAINT "ProxyAuthorizationCode_tokenExchangeId_fkey" FOREIGN KEY ("tokenExchangeId") REFERENCES "ProxyTokenExchange"("id") ON DELETE CASCADE ON UPDATE CASCADE;
