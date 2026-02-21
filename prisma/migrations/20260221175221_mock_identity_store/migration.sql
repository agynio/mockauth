-- CreateTable
CREATE TABLE "MockIdentity" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "strategy" "LoginStrategy" NOT NULL,
    "identifier" TEXT NOT NULL,
    "sub" TEXT NOT NULL,
    "email" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MockIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MockIdentity_sub_key" ON "MockIdentity"("sub");

-- CreateIndex
CREATE UNIQUE INDEX "MockIdentity_tenantId_strategy_identifier_key" ON "MockIdentity"("tenantId", "strategy", "identifier");

-- AddForeignKey
ALTER TABLE "MockIdentity" ADD CONSTRAINT "MockIdentity_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
