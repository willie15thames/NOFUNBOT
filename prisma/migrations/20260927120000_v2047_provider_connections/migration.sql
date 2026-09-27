ALTER TABLE "server_config"
  ADD COLUMN IF NOT EXISTS "customTemplateSelections" JSONB DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS "customSubtemplateSelections" JSONB DEFAULT '[]';

CREATE TABLE IF NOT EXISTS "provider_connections" (
  "id" TEXT PRIMARY KEY,
  "leagueId" TEXT NOT NULL,
  "providerKey" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "healthStatus" TEXT NOT NULL DEFAULT 'unknown',
  "fallbackMode" TEXT NOT NULL DEFAULT 'none',
  "endpointUrl" TEXT,
  "externalLeagueId" TEXT,
  "routeTokenHash" TEXT,
  "secretCiphertext" TEXT,
  "config" JSONB DEFAULT '{}',
  "lastHealthAt" TIMESTAMP(3),
  "lastSyncAt" TIMESTAMP(3),
  "lastSuccessAt" TIMESTAMP(3),
  "lastError" TEXT,
  "blockedReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "provider_connections_leagueId_providerKey_key" ON "provider_connections"("leagueId","providerKey");
CREATE INDEX IF NOT EXISTS "provider_connections_providerKey_status_idx" ON "provider_connections"("providerKey","status");

CREATE TABLE IF NOT EXISTS "provider_sync_runs" (
  "id" TEXT PRIMARY KEY,
  "leagueId" TEXT NOT NULL,
  "providerKey" TEXT NOT NULL,
  "trigger" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "inputRevision" TEXT,
  "metadata" JSONB DEFAULT '{}',
  "result" JSONB,
  "error" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL,
  "finishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "provider_sync_runs_leagueId_providerKey_status_idx" ON "provider_sync_runs"("leagueId","providerKey","status");
CREATE INDEX IF NOT EXISTS "provider_sync_runs_startedAt_idx" ON "provider_sync_runs"("startedAt");
