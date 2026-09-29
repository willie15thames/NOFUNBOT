-- Contract v8 G2/G3: progression/postseason authority + scale hardening
CREATE TABLE IF NOT EXISTS "seasons" (
 "id" TEXT PRIMARY KEY, "guildId" TEXT NOT NULL, "leagueId" TEXT NOT NULL,
 "ordinal" INTEGER, "year" INTEGER, "state" TEXT NOT NULL DEFAULT 'PRESEASON_SETUP',
 "providerSeasonKey" TEXT, "policyVersionId" TEXT, "startsAt" TIMESTAMP(3), "endsAt" TIMESTAMP(3),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "seasons_leagueId_ordinal_key" ON "seasons"("leagueId","ordinal");
CREATE INDEX IF NOT EXISTS "seasons_guildId_leagueId_state_idx" ON "seasons"("guildId","leagueId","state");

CREATE TABLE IF NOT EXISTS "progression_policy_versions" (
 "id" TEXT PRIMARY KEY, "guildId" TEXT NOT NULL, "leagueId" TEXT NOT NULL, "seasonId" TEXT NOT NULL,
 "version" INTEGER NOT NULL, "effectiveAt" TIMESTAMP(3) NOT NULL, "policy" JSONB NOT NULL,
 "createdBy" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "progression_policy_versions_seasonId_version_key" ON "progression_policy_versions"("seasonId","version");
CREATE INDEX IF NOT EXISTS "progression_policy_versions_scope_idx" ON "progression_policy_versions"("guildId","leagueId","seasonId");

CREATE TABLE IF NOT EXISTS "tier_assignments" (
 "id" TEXT PRIMARY KEY, "guildId" TEXT NOT NULL, "leagueId" TEXT NOT NULL, "seasonId" TEXT NOT NULL,
 "teamId" TEXT NOT NULL, "tier" TEXT NOT NULL, "mode" TEXT NOT NULL, "sourceSeed" TEXT, "manualActor" TEXT,
 "finalizedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "tier_assignments_seasonId_teamId_key" ON "tier_assignments"("seasonId","teamId");

CREATE TABLE IF NOT EXISTS "progression_grants" (
 "id" TEXT PRIMARY KEY, "guildId" TEXT NOT NULL, "leagueId" TEXT NOT NULL, "seasonId" TEXT NOT NULL,
 "ownerType" TEXT NOT NULL, "ownerId" TEXT NOT NULL, "rewardType" TEXT NOT NULL,
 "quantity" INTEGER NOT NULL DEFAULT 1 CHECK ("quantity" >= 0), "points" INTEGER NOT NULL DEFAULT 0 CHECK ("points" >= 0),
 "sourceType" TEXT NOT NULL, "sourceId" TEXT NOT NULL DEFAULT '', "status" TEXT NOT NULL DEFAULT 'AVAILABLE',
 "expiresAt" TIMESTAMP(3), "policyVersionId" TEXT NOT NULL, "metadata" JSONB DEFAULT '{}',
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "progression_grants_unique_source" ON "progression_grants"("seasonId","ownerType","ownerId","rewardType","sourceType","sourceId");
CREATE INDEX IF NOT EXISTS "progression_grants_scope_status_idx" ON "progression_grants"("guildId","leagueId","seasonId","ownerType","ownerId","status");

CREATE TABLE IF NOT EXISTS "progression_wallets" (
 "id" TEXT PRIMARY KEY, "guildId" TEXT NOT NULL, "leagueId" TEXT NOT NULL, "seasonId" TEXT NOT NULL,
 "ownerType" TEXT NOT NULL, "ownerId" TEXT NOT NULL, "currency" TEXT NOT NULL,
 "earned" INTEGER NOT NULL DEFAULT 0, "spent" INTEGER NOT NULL DEFAULT 0, "forfeited" INTEGER NOT NULL DEFAULT 0, "locked" INTEGER NOT NULL DEFAULT 0,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK ("earned">=0 AND "spent">=0 AND "forfeited">=0 AND "locked">=0),
 CHECK ("spent"+"forfeited"+"locked" <= "earned")
);
CREATE UNIQUE INDEX IF NOT EXISTS "progression_wallets_owner_key" ON "progression_wallets"("seasonId","ownerType","ownerId","currency");

CREATE TABLE IF NOT EXISTS "progression_claims" (
 "id" TEXT PRIMARY KEY, "guildId" TEXT NOT NULL, "leagueId" TEXT NOT NULL, "seasonId" TEXT NOT NULL,
 "membershipId" TEXT NOT NULL, "teamId" TEXT NOT NULL, "playerId" TEXT NOT NULL,
 "grantId" TEXT, "walletId" TEXT, "policyVersionId" TEXT NOT NULL, "idempotencyKey" TEXT NOT NULL,
 "requestedMutations" JSONB NOT NULL, "status" TEXT NOT NULL DEFAULT 'PENDING', "actorId" TEXT NOT NULL,
 "approvedBy" TEXT, "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "approvedAt" TIMESTAMP(3),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK (("grantId" IS NOT NULL) <> ("walletId" IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS "progression_claims_idempotency_key" ON "progression_claims"("guildId","idempotencyKey");
CREATE INDEX IF NOT EXISTS "progression_claims_scope_status_idx" ON "progression_claims"("guildId","leagueId","seasonId","membershipId","status");

CREATE TABLE IF NOT EXISTS "player_mutations" (
 "id" TEXT PRIMARY KEY, "guildId" TEXT NOT NULL, "leagueId" TEXT NOT NULL, "seasonId" TEXT NOT NULL,
 "membershipId" TEXT, "teamId" TEXT NOT NULL, "playerId" TEXT NOT NULL, "claimId" TEXT NOT NULL,
 "mutationType" TEXT NOT NULL, "attributeKey" TEXT, "points" INTEGER NOT NULL DEFAULT 0,
 "before" JSONB, "after" JSONB, "providerVerification" JSONB, "status" TEXT NOT NULL DEFAULT 'APPLIED',
 "actorId" TEXT NOT NULL, "appliedAt" TIMESTAMP(3) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "player_mutations_scope_idx" ON "player_mutations"("guildId","leagueId","seasonId","teamId","playerId");
CREATE INDEX IF NOT EXISTS "player_mutations_claim_idx" ON "player_mutations"("claimId");

CREATE TABLE IF NOT EXISTS "entitlement_consumptions" (
 "id" TEXT PRIMARY KEY, "grantId" TEXT NOT NULL, "claimId" TEXT NOT NULL, "mutationId" TEXT NOT NULL,
 "quantity" INTEGER NOT NULL DEFAULT 1 CHECK ("quantity">0), "consumedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "entitlement_consumptions_grant_claim_key" ON "entitlement_consumptions"("grantId","claimId");
CREATE UNIQUE INDEX IF NOT EXISTS "entitlement_consumptions_mutation_key" ON "entitlement_consumptions"("mutationId");

CREATE TABLE IF NOT EXISTS "membership_tenures" (
 "id" TEXT PRIMARY KEY, "guildId" TEXT NOT NULL, "leagueId" TEXT NOT NULL, "seasonId" TEXT,
 "membershipId" TEXT NOT NULL, "userId" TEXT NOT NULL, "teamId" TEXT, "joinedAt" TIMESTAMP(3) NOT NULL,
 "leftAt" TIMESTAMP(3), "departureType" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "membership_tenures_scope_idx" ON "membership_tenures"("guildId","leagueId","userId","leftAt");
CREATE INDEX IF NOT EXISTS "membership_tenures_membership_idx" ON "membership_tenures"("membershipId","leftAt");

CREATE TABLE IF NOT EXISTS "postseason_brackets" (
 "id" TEXT PRIMARY KEY, "guildId" TEXT NOT NULL, "leagueId" TEXT NOT NULL, "seasonId" TEXT NOT NULL UNIQUE,
 "format" TEXT NOT NULL, "seedCount" INTEGER NOT NULL, "seeds" JSONB NOT NULL, "status" TEXT NOT NULL DEFAULT 'DRAFT',
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "postseason_brackets_scope_idx" ON "postseason_brackets"("guildId","leagueId","status");

CREATE TABLE IF NOT EXISTS "postseason_matches" (
 "id" TEXT PRIMARY KEY, "bracketId" TEXT NOT NULL, "seasonId" TEXT NOT NULL, "round" INTEGER NOT NULL, "slot" INTEGER NOT NULL,
 "homeTeamId" TEXT, "awayTeamId" TEXT, "winnerTeamId" TEXT, "status" TEXT NOT NULL DEFAULT 'PENDING',
 "advancesToId" TEXT, "providerGameId" TEXT, "resultEvidence" JSONB,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "postseason_matches_bracket_round_slot_key" ON "postseason_matches"("bracketId","round","slot");
CREATE INDEX IF NOT EXISTS "postseason_matches_season_status_idx" ON "postseason_matches"("seasonId","status");

CREATE TABLE IF NOT EXISTS "operation_fences" (
 "guildId" TEXT NOT NULL, "key" TEXT NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY ("guildId","key")
);
CREATE INDEX IF NOT EXISTS "operation_fences_expiresAt_idx" ON "operation_fences"("expiresAt");

CREATE TABLE IF NOT EXISTS "compatibility_paths" (
 "compatId" TEXT PRIMARY KEY, "owner" TEXT NOT NULL, "replacement" TEXT NOT NULL, "removalCondition" TEXT NOT NULL,
 "deadlineRelease" TEXT NOT NULL, "hits" BIGINT NOT NULL DEFAULT 0, "lastHitAt" TIMESTAMP(3),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
