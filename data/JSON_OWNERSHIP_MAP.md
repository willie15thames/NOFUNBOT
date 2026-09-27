# State ownership for package 21.10.0-rc.1

| State | Authority and writer | Scope |
| --- | --- | --- |
| Managed capacity and lifecycle | criticalStore via managedSpaceService | Guild, then immutable space ID |
| Team assignments | criticalStore via teamAssignmentService | Guild, league and team |
| Lifetime history | criticalStore via lifetimeHistoryService | Guild, stable Discord user ID and competition ID |
| Membership | criticalStore via leagueVisibilityService | Guild, space and user |
| Build journal | criticalStore via leagueBuildService | Build session |
| Active league registry | activeLeagueService legacy projection restored from critical space records | Guild and league |
| Runtime, schedule, policy and operational snapshots | jsonStore/scopedState using spaceContext | Space ID |
| Shared team/player projections | jsonStore merge rules | Composite league and team identity |

Critical production writes require PostgreSQL and await commit; configured database failures never fall back to files. BotKv documents remain the current critical storage format. Development without DATABASE_URL uses atomic files and single-process serialization only. Legacy projections and unrelated best-effort stores have not all been converted into transactional authorities. Keep one bot process/replica until those paths are redesigned and validated.

Do not clear v204 history keys during ordinary erase, reset, member departure or rollback. BOT_DATA_DIR contains operational files and readiness state; persist and back it up with the database. New space namespaces preserve old files during guarded migration. See docs/V204_RELEASE_NOTES.md for repair boundaries and the staging acceptance gate.


## RC6 result and stream authority

`v204:lifetime:<guild>` now owns `resultLedgers` (results plus standings per scope) and `streamAccounts` (progress and cooldown), alongside lifetime results/stats/awards and audit events. Result JSON and standings JSON are rebuilt projections. Membership operations live under `v204:memberships:<guild>`; community deletion and active-removal journals use their own `v204:` critical keys. They require PostgreSQL in production. Compatibility JSON remains for older settings and consumers; retain one replica. See the RC6 deployment guide before rollback.
