# V204 audit implementation map

Source of truth is the attached v203.2 ZIP. No production data is used.

- interactionRouter -> leagueSetupService -> activeLeagueService -> JSON registry. Remove activeLeagueService's eager import back into setup; retain public signatures.
- setup -> league/build/leagueBuildService -> Discord channels. Add exclusive space categories, durable journal and reserve/activate/fail lifecycle.
- openTeamsService -> players/openTeamRegistry -> teamRegistryService -> visibility. Keep adapters; scope assignments and release by space; revoke access on departure.
- destructive router -> deleteLeagueStructure / gameChannelService / dataCleanupService. Require exact ID; remove fuzzy deletion and global history wipes.
- gameResultService and award routes -> lifetimeHistoryService -> criticalStore. Preserve source facts and corrections independently of operational cleanup.
- new managedSpaceService -> criticalStore. Slot reservations share one guild key across leagues/events and cannot exceed three.
- criticalStore -> existing BotKv PostgreSQL table (authoritative if DATABASE_URL set), atomic local file for standalone development. No database-error fallback.

Existing message dedup and provider verification remain owned by the documented services. New store transactions are persistence serialization, not a message dedup layer.
