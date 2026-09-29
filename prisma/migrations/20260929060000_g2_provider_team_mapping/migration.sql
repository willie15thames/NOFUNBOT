CREATE TABLE "provider_team_mappings" (
  "id" TEXT NOT NULL,
  "guildId" TEXT NOT NULL,
  "leagueId" TEXT NOT NULL,
  "providerKey" TEXT NOT NULL,
  "teamId" TEXT NOT NULL,
  "externalTeamId" TEXT NOT NULL,
  "mappedBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "provider_team_mappings_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "provider_team_mappings_leagueId_providerKey_teamId_key" ON "provider_team_mappings"("leagueId","providerKey","teamId");
CREATE UNIQUE INDEX "provider_team_mappings_leagueId_providerKey_externalTeamId_key" ON "provider_team_mappings"("leagueId","providerKey","externalTeamId");
CREATE UNIQUE INDEX "player_mutations_unique_provider_readback" ON "player_mutations"("seasonId","playerId","attributeKey",(("providerVerification"->>'snapshotId'))) WHERE "mutationType"='ATTRIBUTE' AND status='APPLIED' AND "providerVerification" IS NOT NULL;
CREATE UNIQUE INDEX "player_mutations_unique_special_readback" ON "player_mutations"("seasonId","playerId","mutationType",(("providerVerification"->>'snapshotId'))) WHERE "mutationType" IN ('DEV_TRAIT','AGE_RESET') AND status='APPLIED' AND "providerVerification" IS NOT NULL;
