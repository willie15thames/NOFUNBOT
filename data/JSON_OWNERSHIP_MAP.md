# JSON State and Config Map

- `activeLeagues.json`: Stores configuration or runtime data used by the application.
- `broadcasts.json`: Stores configuration or runtime data used by the application.
- `gameChannelConfig.json`: Stores configuration or runtime data used by the application.
- `leagues.json`: Stores configuration or runtime data used by the application.
- `liveSync.json`: Stores configuration or runtime data used by the application.
- `loggerConfig.json`: Stores configuration or runtime data used by the application.
- `memberProfiles.json`: Stores configuration or runtime data used by the application.
- `polls.json`: Stores configuration or runtime data used by the application.
- `processBuilder.json`: Builds or manages reusable processes and process lifecycle behavior.
- `scheduleRegistry.json`: Controls scheduling, timers, or recurring execution behavior.
- `stateEngine.json`: Owns or coordinates application state and source-of-truth decisions.
- `streamOps.json`: Stores configuration or runtime data used by the application.
- `teamRegistry.json`: Stores configuration or runtime data used by the application.
- `teamsConfig.json`: Stores configuration or runtime data used by the application.
- `waitlist.json`: Stores configuration or runtime data used by the application.
- `weeklyAutomation.json`: Stores configuration or runtime data used by the application.
- `wizardPreferences.json`: Supports setup wizard rendering, state, routing, or lifecycle behavior.

## V202 files (created at runtime in BOT_DATA_DIR; owner in parentheses)
- `leagueRuntime.json`: advance state machine, workflow vs source week, deadlines, hold, cycle ids (league/runtimeService).
- `automationPolicy.json`: advance automation policy — enabled, interval, shadow mode, prechecks, retries (league/automationPolicyService).
- `gameSessions.json`: durable game-channel sessions keyed by matchupKey (league/gameSessionService).
- `gameResults.json`: canonical game results + revisions (league/gameResultService).
- `importRuns.json`, `importArtifacts.json`: provider import receipts and raw payloads (league/importRunService).
- `companionSnapshots.json`: validated Companion export snapshots (providers/madden/companion/exportGateway).
- `hubWeeklyData.json`: hub staging week (state.js persist loop; timers never stored).
- `rewardHistory.json`: POTW/award/Super Bowl/stream milestone history (state.js persist loop).
- `scheduleStateRuntime.json`: pinned schedule message id + last post time (state.js persist loop).
