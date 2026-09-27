# RC2 correction

Package 21.10.0-rc.2 supersedes RC1 database paths. Read V204_DATABASE_HOTFIX.md before deployment: canonical tables are bot_kv and queue_audit, and the updated audit is 30 pages. The notes below preserve the original RC1 implementation record.

# V204 audit update release candidate

Package 21.10.0-rc.1. Based on the exact v203.2 ZIP supplied with the 26-page audit.

## Implemented

- Removed the active registry/setup circular import that could leave setup with an incomplete export.
- Added awaited PostgreSQL critical-state transactions with advisory locks. Critical writes fail visibly when PostgreSQL fails; no database-error fallback. Standalone development has atomic local files; local mode is single-process only.
- Added a combined cap of three active or pending leagues/events per guild. Reservations survive restart and include partial builds until repaired.
- New leagues receive exclusive categories and a dedicated member role. Everyone is denied channel visibility; staff channels exclude the member role. The documented two-character text channel prefix remains unchanged.
- Added private events with commissioner-managed membership, information and erase actions through setup-event.
- Fixed the Standard join modal token positions and scoped claims by league. Added durable team assignments, access grant failure handling and scoped release. Departures revoke all space memberships without deleting earned history.
- Added space execution context for interaction and message processing; isolated runtime, policy, schedule, imports and state snapshots. The advance scheduler runs per space. Channel resolution selects the space's own IDs. Preserved existing provider verification and advance checks.
- Removed fuzzy destructive channel matching, current-league fallback, global game cleanup during selected deletion, and reward history wipes during reset. Exact-name confirmation displays a resource preview on mismatch. Shared categories/manual children survive.
- Added permanent member career records independent of operational league cleanup. Confirmed game results, corrections/retractions, awards and stream credits are retained. Anonymous historical awards enter an unresolved queue. Lifetime tables are represented as versioned PostgreSQL BotKv documents in this release, not the normalized tables proposed in the audit.
- Added member-record career/export-career, commissioner record-stat and custom award. Statistics are grouped by game/metric. Existing award commands require member attribution for lifetime credit.
- Added guarded legacy migration, durable build journal transitions, schema readiness, /ready health and release provenance.
- Committed a dependency lockfile; deterministic npm ci, corrected Docker schema ordering, Node 22 CI, archive intake limits. Updated adm-zip and Prisma; override deepmerge-ts to patched version. Prisma generation and dependency audit verified locally.

## Required deployment steps

1. Preserve the previous ZIP, database backup and BOT_DATA_DIR. This package contains source only, not your live league data.
2. Deploy to a staging Discord server and staging Railway services first. Keep a single bot replica; existing legacy projections still assume one writer.
3. Set DATABASE_URL, REDIS_URL, BOT_DATA_DIR pointing to a persistent volume, Discord credentials and commissioner role. Do not change the live database URL to a blank database.
4. Run npm ci, npm run prisma:migrate:deploy, npm run schema:check, then npm run start:railway. Migration boot flags remain explicit. Startup refuses missing required schema, including guild_locks.
5. Startup imports uniquely attributable legacy singleton state into its matching space. Original files are retained. Ambiguous history is not guessed. Verify the selected primary league and source records before admitting members.
6. Existing legacy channels require a permission reconciliation before claiming the server is private. New builds are private by construction. Existing categories shared across leagues are preserved by deletion. Do not delete a mixed legacy category manually.
7. Use setup-event name:<name> action:create. Add participants with action:add-member user:<member>. Remove with action:remove-member. Erase uses action:erase and confirm:<exact event name>.
8. Use member-record career for your lifetime record, export-career for JSON, and record-stat inside the selected league channel for verified metrics. Reuse source-id to correct a stat. Member-record award records an event/custom accolade. All member career responses are private; only commissioners can inspect another member.
9. In multiple-league servers, run operational commands inside the selected league's channel. The provider HTTP receiver requires PROVIDER_HTTP_SPACE_ID when more than one league exists. A receiver is bound to one space; other spaces can use their scoped manual/sync paths.
10. Before production, run the acceptance checklist below. This ZIP has not been deployed to the user's Discord or Railway environment.

## Verification and remaining release gates

See VERIFICATION.md for the exact local results. Existing command surface and provider tests remain in the suite. The obsolete test expecting public league categories was replaced by behavior tests for the explicitly requested private access model.

This is a release candidate, not a certification that every audit recommendation is complete. Live Discord effective permissions, Railway image startup, existing-data migration, role hierarchy failures, actual provider round trips and the real PostgreSQL CI job still need staging execution. The PostgreSQL integration test is included but was not run locally because no disposable PostgreSQL service was available.

Remaining engineering work from the full audit includes a normalized scalable history schema/outbox; automatic recovery of ambiguous remote create operations; a commissioner UI for unresolved historical attribution and partial-build repair; comprehensive permission reconciliation on every legacy/manual Discord overwrite; and expanded end-to-end coverage of every trade, event, import and season variant. The per-guild lifetime document is intentionally retained without expiry and can become large; normalize it before large-scale rollout. History is retained through normal app operations, but backups and restore drills are still necessary.

Legacy imported records without stable user IDs are preserved for review, not credited by matching nicknames. Do not advertise complete historical statistics until attribution is reconciled. Career match totals currently reflect confirmed result paths; detailed sport metrics require verified record-stat entry or a future provider-to-metric mapper.

## Staging acceptance checklist

- Three mixed spaces create successfully; simultaneous fourth requests fail.
- A nonmember cannot view each private category/channel; staff-only channels stay staff-only.
- Same team name in two leagues has separate owners; release or leave revokes only appropriate memberships.
- Change A's schedule/policy while B/C remain unchanged, then restart and verify all three.
- Record a result/award/stat; replay it; correct it; leave; erase league; create fresh; return. Lifetime history remains and current-season state starts fresh.
- Erase A while recording B/C resource IDs and record checksums. Shared/manual infrastructure survives.
- Simulate database outage and Discord permission failure. No false success. Inspect pending/repair states and restore from backup.
- Apply migrations to restored staging data, check /ready, verify deployed SHA and run the real PostgreSQL integration test.

## Recovery and rollback

Critical histories and space reservations are PostgreSQL BotKv keys prefixed v204:. Keep these keys during rollback. Older code does not understand new private roles or space namespaces; roll back only after a backup and explicit reconciliation, and do not run an old reset command on migrated data. A partial build continues occupying a slot. Inspect its managed space record and build journal, reconcile exact created resource IDs, then mark it archived only after cleanup. Do not free a pending slot by deleting arbitrary channel names or clearing all BotKv rows.
