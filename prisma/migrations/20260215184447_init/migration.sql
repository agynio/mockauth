-- CreateEnum
CREATE TYPE "TenantStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "MembershipRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER');

-- CreateEnum
CREATE TYPE "ClientType" AS ENUM ('PUBLIC', 'CONFIDENTIAL');

-- CreateEnum
CREATE TYPE "RedirectUriType" AS ENUM ('EXACT', 'HOST_WILDCARD', 'PATH_SUFFIX');

-- CreateEnum
CREATE TYPE "KeyStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "TokenEndpointAuthMethod" AS ENUM ('client_secret_basic', 'client_secret_post', 'none');

-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "TenantStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "logtoSub" TEXT NOT NULL,
    "email" TEXT,
    "name" TEXT,
    "image" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantMembership" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "adminUserId" TEXT NOT NULL,
    "role" "MembershipRole" NOT NULL DEFAULT 'MEMBER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TenantMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Client" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "clientSecretHash" TEXT,
    "clientType" "ClientType" NOT NULL DEFAULT 'CONFIDENTIAL',
    "allowedScopes" TEXT[] DEFAULT ARRAY['openid', 'profile', 'email']::TEXT[],
    "allowedGrantTypes" TEXT[] DEFAULT ARRAY['authorization_code']::TEXT[],
    "allowedResponseTypes" TEXT[] DEFAULT ARRAY['code']::TEXT[],
    "pkceRequired" BOOLEAN NOT NULL DEFAULT true,
    "tokenEndpointAuthMethod" "TokenEndpointAuthMethod" NOT NULL DEFAULT 'client_secret_basic',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RedirectUri" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "uri" TEXT NOT NULL,
    "type" "RedirectUriType" NOT NULL DEFAULT 'EXACT',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RedirectUri_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantKey" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kid" TEXT NOT NULL,
    "kty" TEXT NOT NULL,
    "alg" TEXT NOT NULL,
    "use" TEXT NOT NULL DEFAULT 'sig',
    "status" "KeyStatus" NOT NULL DEFAULT 'ACTIVE',
    "publicJwk" JSONB NOT NULL,
    "privateJwkEncrypted" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MockUser" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "displayName" TEXT,
    "email" TEXT,
    "claims" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MockUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MockSession" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionTokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MockSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthorizationCode" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
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

    CONSTRAINT "AuthorizationCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccessToken" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "jti" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccessToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_slug_key" ON "Tenant"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "User_logtoSub_key" ON "User"("logtoSub");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "TenantMembership_tenantId_adminUserId_key" ON "TenantMembership"("tenantId", "adminUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Client_tenantId_clientId_key" ON "Client"("tenantId", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "RedirectUri_clientId_uri_key" ON "RedirectUri"("clientId", "uri");

-- CreateIndex
CREATE INDEX "TenantKey_tenantId_status_idx" ON "TenantKey"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TenantKey_tenantId_kid_key" ON "TenantKey"("tenantId", "kid");

-- CreateIndex
CREATE UNIQUE INDEX "MockUser_tenantId_username_key" ON "MockUser"("tenantId", "username");

-- CreateIndex
CREATE UNIQUE INDEX "MockSession_sessionTokenHash_key" ON "MockSession"("sessionTokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "AuthorizationCode_codeHash_key" ON "AuthorizationCode"("codeHash");

-- CreateIndex
CREATE INDEX "AuthorizationCode_tenantId_clientId_idx" ON "AuthorizationCode"("tenantId", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "AccessToken_jti_key" ON "AccessToken"("jti");

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_token_key" ON "VerificationToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_identifier_token_key" ON "VerificationToken"("identifier", "token");

-- AddForeignKey
ALTER TABLE "TenantMembership" ADD CONSTRAINT "TenantMembership_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantMembership" ADD CONSTRAINT "TenantMembership_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RedirectUri" ADD CONSTRAINT "RedirectUri_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantKey" ADD CONSTRAINT "TenantKey_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MockUser" ADD CONSTRAINT "MockUser_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MockSession" ADD CONSTRAINT "MockSession_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MockSession" ADD CONSTRAINT "MockSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "MockUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthorizationCode" ADD CONSTRAINT "AuthorizationCode_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthorizationCode" ADD CONSTRAINT "AuthorizationCode_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthorizationCode" ADD CONSTRAINT "AuthorizationCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "MockUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessToken" ADD CONSTRAINT "AccessToken_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessToken" ADD CONSTRAINT "AccessToken_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessToken" ADD CONSTRAINT "AccessToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "MockUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
