CREATE TABLE IF NOT EXISTS "BotKv" (
  "key" TEXT PRIMARY KEY,
  "value" JSONB NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'json',
  "checksum" TEXT,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "GuildSetting" (
  "guildId" TEXT PRIMARY KEY,
  "botStatus" TEXT NOT NULL DEFAULT 'active',
  "audience" TEXT,
  "filterMode" TEXT DEFAULT 'strict',
  "toneVisible" TEXT DEFAULT 'public',
  "timezone" TEXT,
  "payload" JSONB,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "QueueAudit" (
  "id" BIGSERIAL PRIMARY KEY,
  "queueName" TEXT NOT NULL,
  "jobName" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "payload" JSONB,
  "result" JSONB,
  "error" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
