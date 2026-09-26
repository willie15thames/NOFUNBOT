-- ============================================================
-- V110 Migration — Guide State, Audit Events, Background Jobs,
--                  Pending Offenses, Stream Credits,
--                  Feature Flags, Channel Topology
-- Generated from: Dynamic Guide Flows Blueprint + DB Plan v1
-- Aligns with: blueprint GuideLifecycleService spec
--              Action Chart Phase 3 (DB-backed state)
--              Architecture Audit findings BUG-05, STATIC-04
-- ============================================================

-- ── guide_state ────────────────────────────────────────────────
-- Tracks per-channel guide lifecycle state.
-- Implements blueprint Section 2 data model exactly.
-- GuideLifecycleService reads/writes this table exclusively.
CREATE TABLE IF NOT EXISTS "guide_state" (
  "id"                    TEXT        NOT NULL PRIMARY KEY,
  "guildId"               TEXT        NOT NULL,
  "channelId"             TEXT        NOT NULL,
  "guideChannelRole"      TEXT        NOT NULL,  -- setup-wizard | welcome | league-guide | community
  "guideAnchorMessageId"  TEXT,                  -- current visible guide message id (bot-owned)
  "pinnedGuideMessageId"  TEXT,                  -- canonical pinned guide message id
  "lastActivityAt"        TIMESTAMP(3),          -- latest user activity in this channel
  "idleRefreshAfterMs"    INTEGER     NOT NULL DEFAULT 900000,  -- 15 min default
  "lastRenderedStateHash" TEXT,                  -- hash of guide-relevant state subset
  "lastRefreshReason"     TEXT,                  -- idle-refresh | state-change | rename-repair | manual
  "lastRefreshAt"         TIMESTAMP(3),
  "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  "updatedAt"             TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  UNIQUE("guildId", "channelId"),
  FOREIGN KEY ("guildId") REFERENCES "server_config"("guildId") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "guide_state_guildId_idx" ON "guide_state"("guildId");
CREATE INDEX IF NOT EXISTS "guide_state_role_idx"    ON "guide_state"("guildId", "guideChannelRole");

-- ── wizard_state ───────────────────────────────────────────────
-- Persistent wizard step state. Fixes LOCK-01 and LOCK-02.
-- This becomes the single authoritative store for wizard progress.
-- wizardPreferencesService wizardStage and wizardStarterMessageId
-- are retired and replaced by this table.
CREATE TABLE IF NOT EXISTS "wizard_state" (
  "id"                TEXT        NOT NULL PRIMARY KEY,
  "guildId"           TEXT        NOT NULL UNIQUE,
  "currentStep"       TEXT        NOT NULL DEFAULT 'flow',  -- flow|mode|custom_structure|tone|finalize
  "subStep"           TEXT,
  "completedSteps"    JSONB       NOT NULL DEFAULT '[]',
  "activeMessageId"   TEXT,                   -- single authoritative wizard message id
  "installationMode"  BOOLEAN     NOT NULL DEFAULT TRUE,
  "editMode"          BOOLEAN     NOT NULL DEFAULT FALSE,
  "selectedSetupMode" TEXT,                   -- standard | custom
  "lastAdvancedAt"    TIMESTAMP(3),
  "lastBuildAt"       TIMESTAMP(3),
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  FOREIGN KEY ("guildId") REFERENCES "server_config"("guildId") ON DELETE CASCADE
);

-- ── channel_topology ───────────────────────────────────────────
-- Stores resolved channel IDs and naming policy outputs.
-- Implements ChannelNamingPolicy spec from Blueprint Section 4.
-- Replaces runtime CHANNEL_KEYS dictionary lookups for guild-specific state.
CREATE TABLE IF NOT EXISTS "channel_topology" (
  "id"                TEXT        NOT NULL PRIMARY KEY,
  "guildId"           TEXT        NOT NULL,
  "channelKey"        TEXT        NOT NULL,  -- welcome | rules | setupWizard | leagueGuide etc.
  "channelId"         TEXT,                  -- resolved Discord channel id
  "channelName"       TEXT,                  -- actual Discord channel name at time of resolution
  "displayLabel"      TEXT,                  -- brand-resolved display label (e.g. "dynasty-floor")
  "profileVersion"    TEXT,                  -- naming profile version that produced this entry
  "lastVerifiedAt"    TIMESTAMP(3),
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  UNIQUE("guildId", "channelKey"),
  FOREIGN KEY ("guildId") REFERENCES "server_config"("guildId") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "channel_topology_guildId_idx" ON "channel_topology"("guildId");

-- ── audit_events ───────────────────────────────────────────────
-- Structured telemetry log for all system events.
-- Implements blueprint Section 6 telemetry spec.
-- Action Chart: "Add progress milestones inside destructive flows"
CREATE TABLE IF NOT EXISTS "audit_events" (
  "id"          BIGSERIAL   NOT NULL PRIMARY KEY,
  "guildId"     TEXT        NOT NULL,
  "userId"      TEXT,                   -- Discord user id who triggered the event (null = system)
  "eventType"   TEXT        NOT NULL,   -- guide-refresh | wizard-advance | build-server | trash | member-join etc.
  "category"    TEXT,                   -- guide | wizard | member | league | moderation | system
  "channelId"   TEXT,
  "payload"     JSONB,                  -- event-specific data (stateHash, reason, latencyMs, etc.)
  "outcome"     TEXT,                   -- success | failure | skipped
  "errorMsg"    TEXT,
  "latencyMs"   INTEGER,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "audit_events_guildId_idx"   ON "audit_events"("guildId");
CREATE INDEX IF NOT EXISTS "audit_events_type_idx"      ON "audit_events"("guildId", "eventType");
CREATE INDEX IF NOT EXISTS "audit_events_createdAt_idx" ON "audit_events"("createdAt");

-- ── pending_offenses ──────────────────────────────────────────
-- Fixes BUG-05: persists in-flight offense reports that survive bot restart.
-- In-memory state.pendingOffenses Map is replaced by this table.
-- Buttons in #warnings-log resolve their offenseId from here on restart.
CREATE TABLE IF NOT EXISTS "pending_offenses" (
  "id"            TEXT        NOT NULL PRIMARY KEY,  -- offenseId (matches button customId)
  "guildId"       TEXT        NOT NULL,
  "userId"        TEXT        NOT NULL,              -- accused member Discord id
  "channelId"     TEXT,
  "messageId"     TEXT,
  "offenseType"   TEXT        NOT NULL,              -- QUIT | GAMEPLAY | INACTIVITY | CHEAT
  "reasoning"     TEXT,
  "teamName"      TEXT,
  "confidence"    TEXT,                              -- high | medium | low
  "status"        TEXT        NOT NULL DEFAULT 'pending',  -- pending | warned | booted | dismissed
  "resolvedBy"    TEXT,                              -- Discord id of commissioner who resolved
  "resolvedAt"    TIMESTAMP(3),
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  FOREIGN KEY ("guildId") REFERENCES "server_config"("guildId") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "pending_offenses_guildId_idx"  ON "pending_offenses"("guildId");
CREATE INDEX IF NOT EXISTS "pending_offenses_status_idx"   ON "pending_offenses"("guildId", "status");

-- ── offense_cooldowns ─────────────────────────────────────────
-- Fixes BUG-05 (companion): persists per-user offense detection cooldowns.
-- Replaces in-memory state.offenseCooldowns Map.
CREATE TABLE IF NOT EXISTS "offense_cooldowns" (
  "guildId"       TEXT        NOT NULL,
  "userId"        TEXT        NOT NULL,
  "lastFlaggedAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  PRIMARY KEY ("guildId", "userId")
);

-- ── stream_credits ────────────────────────────────────────────
-- Persists per-player stream credit log.
-- Replaces player.streamLog[] array in runtime state.
-- Fixes restart data loss for stream progress / reward tracking.
CREATE TABLE IF NOT EXISTS "stream_credits" (
  "id"          BIGSERIAL   NOT NULL PRIMARY KEY,
  "guildId"     TEXT        NOT NULL,
  "userId"      TEXT        NOT NULL,
  "teamName"    TEXT,
  "streamUrl"   TEXT,
  "messageId"   TEXT,                   -- Discord message id for dedup
  "rewardLabel" TEXT,                   -- reward unlocked at this count, if any
  "creditedAt"  TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  UNIQUE("guildId", "messageId"),
  FOREIGN KEY ("guildId") REFERENCES "server_config"("guildId") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "stream_credits_user_idx" ON "stream_credits"("guildId", "userId");

-- ── feature_flags ─────────────────────────────────────────────
-- Per-guild feature flag store. Replaces scattered boolean fields
-- in server_config for anything that is toggleable mid-runtime.
-- Enables the "AI capability flags + allowlist" driver from Blueprint Section 5.
CREATE TABLE IF NOT EXISTS "feature_flags" (
  "guildId"     TEXT        NOT NULL,
  "flag"        TEXT        NOT NULL,   -- aiMentionEnabled | guideLifecycleEnabled | backgroundJobsEnabled etc.
  "enabled"     BOOLEAN     NOT NULL DEFAULT FALSE,
  "metadata"    JSONB,                  -- per-flag config (e.g. allowlist channels, rate limits)
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  PRIMARY KEY ("guildId", "flag"),
  FOREIGN KEY ("guildId") REFERENCES "server_config"("guildId") ON DELETE CASCADE
);

-- ── background_jobs ───────────────────────────────────────────
-- DB-backed job queue for long-running admin operations.
-- Action Chart Phase 3: "Background job handling for slow work"
-- Allows mobile admins to trigger heavy ops (trash/rebuild, full init)
-- without babysitting the command window.
CREATE TABLE IF NOT EXISTS "background_jobs" (
  "id"            TEXT        NOT NULL PRIMARY KEY,
  "guildId"       TEXT        NOT NULL,
  "jobType"       TEXT        NOT NULL,   -- server-build | trash-rebuild | week-advance | guide-refresh-all
  "status"        TEXT        NOT NULL DEFAULT 'queued',  -- queued | running | done | failed | cancelled
  "triggeredBy"   TEXT,                   -- Discord user id
  "payload"       JSONB,                  -- job input params
  "progress"      JSONB,                  -- { step, totalSteps, lastNote }
  "result"        JSONB,
  "errorMsg"      TEXT,
  "startedAt"     TIMESTAMP(3),
  "completedAt"   TIMESTAMP(3),
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  FOREIGN KEY ("guildId") REFERENCES "server_config"("guildId") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "background_jobs_guildId_idx" ON "background_jobs"("guildId");
CREATE INDEX IF NOT EXISTS "background_jobs_status_idx"  ON "background_jobs"("guildId", "status");

-- ── member_ledger ─────────────────────────────────────────────
-- Durable member history. Replaces in-memory/JSON memberLedger.
-- Tracks join/leave/kick/ban history and warning counts per guild.
CREATE TABLE IF NOT EXISTS "member_ledger" (
  "id"                    TEXT        NOT NULL PRIMARY KEY,
  "guildId"               TEXT        NOT NULL,
  "userId"                TEXT        NOT NULL,
  "discordTag"            TEXT,
  "joinCount"             INTEGER     NOT NULL DEFAULT 0,
  "leaveCount"            INTEGER     NOT NULL DEFAULT 0,
  "kickCount"             INTEGER     NOT NULL DEFAULT 0,
  "banCount"              INTEGER     NOT NULL DEFAULT 0,
  "totalWarnings"         INTEGER     NOT NULL DEFAULT 0,
  "gameplayWarnings"      INTEGER     NOT NULL DEFAULT 0,
  "closeAppWarnings"      INTEGER     NOT NULL DEFAULT 0,
  "inactivityWarnings"    INTEGER     NOT NULL DEFAULT 0,
  "isBanned"              BOOLEAN     NOT NULL DEFAULT FALSE,
  "inactivityNotified"    BOOLEAN     NOT NULL DEFAULT FALSE,
  "lastActivityAt"        TIMESTAMP(3),
  "lastJoinedAt"          TIMESTAMP(3),
  "firstJoinedAt"         TIMESTAMP(3),
  "notes"                 JSONB       NOT NULL DEFAULT '[]',   -- commissioner notes []
  "kickHistory"           JSONB       NOT NULL DEFAULT '[]',   -- [{reason, timestamp, by}]
  "banHistory"            JSONB       NOT NULL DEFAULT '[]',
  "teamHistory"           JSONB       NOT NULL DEFAULT '[]',   -- [{team, joinedAt, leftAt}]
  "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  "updatedAt"             TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  UNIQUE("guildId", "userId"),
  FOREIGN KEY ("guildId") REFERENCES "server_config"("guildId") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "member_ledger_guildId_idx" ON "member_ledger"("guildId");
CREATE INDEX IF NOT EXISTS "member_ledger_userId_idx"  ON "member_ledger"("guildId", "userId");

-- ── Trigger: auto-update updatedAt on guide_state ─────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW."updatedAt" = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'guide_state_updated_at') THEN
    CREATE TRIGGER guide_state_updated_at
      BEFORE UPDATE ON "guide_state"
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'wizard_state_updated_at') THEN
    CREATE TRIGGER wizard_state_updated_at
      BEFORE UPDATE ON "wizard_state"
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'background_jobs_updated_at') THEN
    CREATE TRIGGER background_jobs_updated_at
      BEFORE UPDATE ON "background_jobs"
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'member_ledger_updated_at') THEN
    CREATE TRIGGER member_ledger_updated_at
      BEFORE UPDATE ON "member_ledger"
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;
