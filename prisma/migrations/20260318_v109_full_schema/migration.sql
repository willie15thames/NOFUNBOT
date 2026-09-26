-- V109 Full Schema Migration
-- Adds: server_config, users, communities, user_communities, leagues, teams,
--       team_members, events, role_mappings, schedules
-- Keeps: bot_kv, queue_audit (renamed from BotKv, QueueAudit)

-- server_config
CREATE TABLE IF NOT EXISTS "server_config" (
  "id"                  TEXT NOT NULL PRIMARY KEY,
  "guildId"             TEXT NOT NULL UNIQUE,
  "template"            TEXT,
  "subtemplate"         TEXT,
  "theme"               TEXT,
  "timezoneGateEnabled" BOOLEAN NOT NULL DEFAULT FALSE,
  "setupComplete"       BOOLEAN NOT NULL DEFAULT FALSE,
  "botStatus"           TEXT NOT NULL DEFAULT 'active',
  "audienceRating"      TEXT NOT NULL DEFAULT 'pg13',
  "filterMode"          TEXT NOT NULL DEFAULT 'strict',
  "toneProfile"         JSONB,
  "memberToneProfile"   JSONB,
  "commToneProfile"     JSONB,
  "botName"             TEXT NOT NULL DEFAULT 'myBot',
  "allowGifReplies"     BOOLEAN NOT NULL DEFAULT TRUE,
  "requireTimezone"     BOOLEAN NOT NULL DEFAULT FALSE,
  "serverInitialized"   BOOLEAN NOT NULL DEFAULT FALSE,
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  "updatedAt"           TIMESTAMP(3) NOT NULL DEFAULT NOW()
);

-- users
CREATE TABLE IF NOT EXISTS "users" (
  "id"            TEXT NOT NULL PRIMARY KEY,
  "guildId"       TEXT NOT NULL,
  "userId"        TEXT NOT NULL,
  "timezone"      TEXT,
  "timezoneLabel" TEXT,
  "nicknameBase"  TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  UNIQUE("guildId", "userId")
);

-- communities
CREATE TABLE IF NOT EXISTS "communities" (
  "id"        TEXT NOT NULL PRIMARY KEY,
  "guildId"   TEXT NOT NULL,
  "name"      TEXT NOT NULL,
  "type"      TEXT NOT NULL DEFAULT 'social',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  UNIQUE("guildId", "name"),
  FOREIGN KEY ("guildId") REFERENCES "server_config"("guildId") ON DELETE CASCADE
);

-- user_communities
CREATE TABLE IF NOT EXISTS "user_communities" (
  "userId"      TEXT NOT NULL,
  "communityId" TEXT NOT NULL,
  "joinedAt"    TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  PRIMARY KEY ("userId", "communityId"),
  FOREIGN KEY ("userId")      REFERENCES "users"("id")       ON DELETE CASCADE,
  FOREIGN KEY ("communityId") REFERENCES "communities"("id") ON DELETE CASCADE
);

-- leagues
CREATE TABLE IF NOT EXISTS "leagues" (
  "id"          TEXT NOT NULL PRIMARY KEY,
  "communityId" TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "game"        TEXT,
  "seasonType"  TEXT,
  "seasonWeeks" INTEGER,
  "isActive"    BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  FOREIGN KEY ("communityId") REFERENCES "communities"("id") ON DELETE CASCADE
);

-- teams
CREATE TABLE IF NOT EXISTS "teams" (
  "id"          TEXT NOT NULL PRIMARY KEY,
  "leagueId"    TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "displayName" TEXT,
  "location"    TEXT,
  "logoUrl"     TEXT,
  "isOpen"      BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  UNIQUE("leagueId", "name"),
  FOREIGN KEY ("leagueId") REFERENCES "leagues"("id") ON DELETE CASCADE
);

-- team_members
CREATE TABLE IF NOT EXISTS "team_members" (
  "userId"   TEXT NOT NULL,
  "teamId"   TEXT NOT NULL,
  "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  PRIMARY KEY ("userId", "teamId"),
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE,
  FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE CASCADE
);

-- events
CREATE TABLE IF NOT EXISTS "events" (
  "id"          TEXT NOT NULL PRIMARY KEY,
  "guildId"     TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "description" TEXT,
  "startTime"   TIMESTAMP(3),
  "endTime"     TIMESTAMP(3),
  "channelId"   TEXT,
  "isActive"    BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  FOREIGN KEY ("guildId") REFERENCES "server_config"("guildId") ON DELETE CASCADE
);

-- role_mappings
CREATE TABLE IF NOT EXISTS "role_mappings" (
  "id"          TEXT NOT NULL PRIMARY KEY,
  "guildId"     TEXT NOT NULL,
  "communityId" TEXT,
  "roleId"      TEXT NOT NULL,
  "roleName"    TEXT,
  "purpose"     TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  FOREIGN KEY ("communityId") REFERENCES "communities"("id") ON DELETE SET NULL
);

-- schedules
CREATE TABLE IF NOT EXISTS "schedules" (
  "id"         TEXT NOT NULL PRIMARY KEY,
  "leagueId"   TEXT NOT NULL,
  "week"       INTEGER NOT NULL,
  "matchups"   JSONB,
  "postedAt"   TIMESTAMP(3),
  "advancedAt" TIMESTAMP(3),
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  UNIQUE("leagueId", "week"),
  FOREIGN KEY ("leagueId") REFERENCES "leagues"("id") ON DELETE CASCADE
);

-- Rename legacy tables if they exist under old names
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE tablename = 'BotKv') THEN
    ALTER TABLE "BotKv" RENAME TO "bot_kv";
  END IF;
  IF EXISTS (SELECT FROM pg_tables WHERE tablename = 'QueueAudit') THEN
    ALTER TABLE "QueueAudit" RENAME TO "queue_audit";
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "bot_kv" (
  "key"       TEXT NOT NULL PRIMARY KEY,
  "value"     JSONB NOT NULL,
  "source"    TEXT NOT NULL DEFAULT 'json',
  "checksum"  TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "queue_audit" (
  "id"        BIGSERIAL PRIMARY KEY,
  "queueName" TEXT NOT NULL,
  "jobName"   TEXT NOT NULL,
  "status"    TEXT NOT NULL,
  "payload"   JSONB,
  "result"    JSONB,
  "error"     TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT NOW()
);
