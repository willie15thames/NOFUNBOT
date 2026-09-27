-- v204.7 durable provider import receipts
CREATE TABLE IF NOT EXISTS "provider_import_receipts" (
  "id" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "leagueId" TEXT NOT NULL,
  "providerKey" TEXT NOT NULL,
  "identityKey" TEXT NOT NULL,
  "externalEventId" TEXT,
  "payloadHash" TEXT,
  "stage" TEXT,
  "size" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'received',
  "artifactBody" TEXT,
  "meta" JSONB DEFAULT '{}',
  "duplicateDeliveries" INTEGER NOT NULL DEFAULT 0,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "provider_import_receipts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "provider_import_receipts_connectionId_identityKey_key" ON "provider_import_receipts"("connectionId","identityKey");
CREATE INDEX IF NOT EXISTS "provider_import_receipts_leagueId_providerKey_status_idx" ON "provider_import_receipts"("leagueId","providerKey","status");
CREATE INDEX IF NOT EXISTS "provider_import_receipts_providerKey_status_receivedAt_idx" ON "provider_import_receipts"("providerKey","status","receivedAt");
