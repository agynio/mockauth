-- CreateTable
CREATE TABLE "PostLogoutRedirectUri" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "uri" TEXT NOT NULL,
    "type" "RedirectUriType" NOT NULL DEFAULT 'EXACT',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PostLogoutRedirectUri_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PostLogoutRedirectUri_clientId_uri_key" ON "PostLogoutRedirectUri"("clientId", "uri");

-- AddForeignKey
ALTER TABLE "PostLogoutRedirectUri" ADD CONSTRAINT "PostLogoutRedirectUri_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
