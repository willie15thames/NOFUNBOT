-- Contract v8 G2 completion: durable legacy cutover queue + active-tenure integrity.
CREATE TABLE IF NOT EXISTS "legacy_progression_migrations" (
  "id" TEXT NOT NULL,
  "guildId" TEXT NOT NULL,
  "leagueId" TEXT NOT NULL,
  "seasonId" TEXT,
  "sourceType" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "userId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'REVIEW_REQUIRED',
  "payload" JSONB NOT NULL,
  "resolution" JSONB DEFAULT '{}'::jsonb,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "legacy_progression_migrations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "legacy_progression_migrations_guild_source_key"
  ON "legacy_progression_migrations"("guildId","sourceType","sourceId");
CREATE INDEX IF NOT EXISTS "legacy_progression_migrations_scope_status_idx"
  ON "legacy_progression_migrations"("guildId","leagueId","seasonId","status");

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "membership_tenures"
    WHERE "leftAt" IS NULL
    GROUP BY "guildId","leagueId","seasonId","userId"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'G2 migration blocked: duplicate active membership tenures must be reconciled first';
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS "membership_tenures_one_active_user_per_season"
  ON "membership_tenures"("guildId","leagueId","seasonId","userId")
  WHERE "leftAt" IS NULL;
