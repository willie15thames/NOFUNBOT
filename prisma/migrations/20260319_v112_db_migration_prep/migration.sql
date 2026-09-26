-- v112: DB migration prep — schema gaps, MemberProfile, guild locks

ALTER TABLE "server_config"
  ADD COLUMN IF NOT EXISTS "payload"                   JSONB,
  ADD COLUMN IF NOT EXISTS "useSharedToneProfile"      BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "setupCompletedAt"          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "botAvatarMode"             TEXT,
  ADD COLUMN IF NOT EXISTS "botAvatarUrl"              TEXT,
  ADD COLUMN IF NOT EXISTS "botAvatarEmoji"            TEXT,
  ADD COLUMN IF NOT EXISTS "serverTemplate"            TEXT,
  ADD COLUMN IF NOT EXISTS "serverSubtemplate"         TEXT,
  ADD COLUMN IF NOT EXISTS "customStructureMode"       TEXT,
  ADD COLUMN IF NOT EXISTS "customArrangementMode"     TEXT DEFAULT 'auto',
  ADD COLUMN IF NOT EXISTS "customCatalogSelections"   JSONB DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS "toneVisibility"            TEXT DEFAULT 'public',
  ADD COLUMN IF NOT EXISTS "ageWarningEnabled"         BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "teams"
  ADD COLUMN IF NOT EXISTS "isOpen"          BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "ownerId"         TEXT,
  ADD COLUMN IF NOT EXISTS "displayTeam"     TEXT,
  ADD COLUMN IF NOT EXISTS "logoUrl"         TEXT,
  ADD COLUMN IF NOT EXISTS "replacementFor"  TEXT,
  ADD COLUMN IF NOT EXISTS "isCustomTeam"    BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "leagues"
  ADD COLUMN IF NOT EXISTS "leagueTypeId"       TEXT,
  ADD COLUMN IF NOT EXISTS "builtCategoryIds"   JSONB DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS "builtChannelIds"    JSONB DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS "commissionerRoleId" TEXT,
  ADD COLUMN IF NOT EXISTS "isCustom"           BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "leagueTag"          TEXT;

CREATE TABLE IF NOT EXISTS "member_profiles" (
  "id"                  TEXT NOT NULL,
  "guildId"             TEXT NOT NULL,
  "userId"              TEXT NOT NULL,
  "timezone"            TEXT,
  "timezoneLabel"       TEXT,
  "nicknameBase"        TEXT,
  "lastSeenDisplayName" TEXT,
  "streamCount"         INTEGER NOT NULL DEFAULT 0,
  "createdAt"           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "member_profiles_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "member_profiles_guildId_userId_key"
  ON "member_profiles"("guildId","userId");

CREATE TABLE IF NOT EXISTS "guild_locks" (
  "guildId"   TEXT NOT NULL,
  "lockType"  TEXT NOT NULL,
  "lockedBy"  TEXT,
  "lockedAt"  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "expiresAt" TIMESTAMPTZ,
  CONSTRAINT "guild_locks_pkey" PRIMARY KEY ("guildId","lockType")
);
