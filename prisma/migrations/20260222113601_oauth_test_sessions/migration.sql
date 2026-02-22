-- CreateTable
CREATE TABLE "OAuthTestSession" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "codeVerifier" TEXT NOT NULL,
    "redirectUri" TEXT NOT NULL,
    "scopes" TEXT NOT NULL,
    "nonce" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OAuthTestSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OAuthTestSession_clientId_idx" ON "OAuthTestSession"("clientId");

-- AddForeignKey
ALTER TABLE "OAuthTestSession" ADD CONSTRAINT "OAuthTestSession_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
