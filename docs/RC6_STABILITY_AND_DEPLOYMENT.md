# NOFUNBOT RC6 stability repairs and deployment

**Package:** 21.10.0-rc.6. **Archive:** nofunleague-v204.5-stability-rc6.zip. **Date:** 27 September 2026.

The thirteen RC5 fault cases have implementation changes and passing local regression assertions. This is a staging candidate. Production release still requires the PostgreSQL CI job, effective Discord permission checks, worker recovery and a backup restore rehearsal. Code has not been pushed to GitHub or deployed to Railway from this workspace.

Read this file before older release notes. The RC5 audit appendix describes the faults before these repairs. Its original “open” findings are historical; this repair matrix is the current implementation status. “Locally verified” means isolated tests with mocked Discord and local durable storage, not a live service certification.

## What changed

| Finding | Implemented repair | Local evidence |
| --- | --- | --- |
| F01 unsafe template cleanup | Edited manifest channels and untracked lookalikes are preserved. Generated topic text alone cannot authorize deletion. | Rename, topic, parent and lookalike cases |
| F02 access without committed membership | Write pending intent before Discord changes; compensate introduced access on failure; retain repair intent and recover on startup. Revocation is journaled. | Final commit failure, failed compensation, restart recovery, departed member overwrite cleanup |
| F03 player key collisions | Players use league-qualified canonical keys. Existing qualified keys remain valid. Ambiguous legacy ownership blocks startup for review. | Three leagues with the same team name |
| F04 failed event remains active | Archive retention must commit before publishing the event in the active registry. Failed builds remove the active projection and compensate resources. | Injected archive failure leaves no active event or resources |
| F05 duplicate standings | Results, revisions, standings and lifetime results share one transaction. JSON views are rebuildable projections. | Ten simultaneous identical submissions count once |
| F06 repeated retraction | Retraction reverses standings and marks lifetime result retracted in one transaction. A retry changes nothing. | Transaction failure and parallel retraction |
| F07 conflicting destructive commands | Structural commands share a guild lock for the whole operation. PostgreSQL session locks have no short lease to expire mid-build. | Conflicting commands and held callback; cross-process CI assertion added |
| F08 private URL access | Normalize blocked IP ranges and validate resolved DNS addresses at connection time through the shared HTTP intake. Redirects remain disabled. | IPv4/IPv6 and mixed public/private DNS answers |
| F09 YouTube credits | Standard watch URLs, live paths and short URLs are recognized alongside Twitch and Kick. | Supported URLs and deceptive hostname rejection |
| F10 unsafe active checks | One league failure does not stop others. Only the notified audience can accrue misses. Pending removals are journaled before access changes. | Failed post isolation, late joiner, prior league-only removal tests |
| F11 nickname churn | Automatic cleanup requires an exact recorded bot assignment. Intentional native nicknames are preserved. Per-message nickname switching is removed. | Manual team-like names and proven old assignments |
| F12 stream rollover bypass | Durable message identity, progress, cooldown and award commit together. Rollover preserves cooldown; manual adjustment retries preserve earned history. | Sixteenth-credit rollover, duplicate, reset and cooldown checks |
| F13 false deletion success | Capture owned IDs, keep a repair journal, report partial failure and retry those IDs. Preserve a category if new children appear during deletion. | Permission failure followed by retry after rename |

Additional operational work: periodic dependency readiness, stale heartbeat rejection, Discord disconnect detection, a bounded shared producer queue cache, queue worker startup timeout, process supervision, bounded shutdown and pending compatibility-write flushing. Startup failures terminate so the supervisor can restart the service. Stream progress projections rebuild from lifetime authority during migration.

## Requirements retained

- Up to three combined active or reserved league/event slots. A fourth request is rejected; it is not three leagues plus three events.
- Private space membership roles with readable names for tagging. Ordinary channel names remain inside distinct categories.
- League deletion releases operational resources while retaining member lifetime results, supported statistics and awards by guild ID plus Discord user ID. Rejoining with the same Discord account reconnects that history.
- A native Discord nickname exists per server, not per category. Team identity is displayed in scoped bot content. The bot does not repeatedly rename members when they post in different league channels.
- Commissioner authorization still follows configured roles/permissions. Discord role hierarchy still prevents the bot from editing the server owner or higher/equal ranked members. No code can bypass that rule.
- Corrections/retractions change current totals but retain audit events. Lifetime retention is not a promise that an external database deletion can be recovered without backups.

## Local verification

Run `npm run verify:local` after `npm ci`. The helper forces isolated temporary data, test credentials, no live database/Redis and disabled AI. It runs the type/configuration check and the full release gate, then removes its temporary data directory.

The release gate includes changelog version, dependency/environment loading, command registrations, unresolved executable identifier scan and all test files. At this release: 122 assertions across 15 files pass. This includes 19 focused RC6 assertions. Four earlier expectations were updated explicitly: two cleanup fixtures now establish real ownership, nickname cleanup requires provenance, and active-check errors are reported per league instead of thrown for the entire batch.

`npm run tsc` uses the existing checkJs=false setting. The separate identifier check catches unresolved executable identifiers but does not prove full JavaScript type correctness. Static syntax and literal-import resolution do not exercise every runtime branch.

PostgreSQL integration coverage was expanded to include contention from another process and concurrent score submission/retraction followed by connection reopen. It was not run against a networked PostgreSQL server in this workspace. GitHub Actions provisions PostgreSQL 16 and runs migrations, schema checks and `npm run test:postgres`. A workflow file existing in the ZIP is not evidence of a passing remote workflow.

## Your VS Code terminal steps

Download the ZIP into your Mac Downloads folder. Open VS Code, then **Terminal > New Terminal**. Use Node 22, matching Docker and CI. `node --version` should print v22.x. These commands create a separate checkout and a review branch:

```bash
git clone --branch main https://github.com/willie15thames/NOFUNBOT.git "$HOME/Downloads/NOFUNBOT-rc6"
cd "$HOME/Downloads/NOFUNBOT-rc6"
git switch -c fix/rc6-stability
unzip -o "$HOME/Downloads/nofunleague-v204.5-stability-rc6.zip" -d .
npm ci
npm run verify:local
git diff --check
git diff --stat
git status --short
```

Run each line only after the preceding command succeeds. If that destination already exists, use a different new folder name on both the clone and cd lines; do not delete or overwrite your existing working directory. If the downloaded ZIP has a different filename, use its actual filename. Source is at the ZIP root, with index.js and package.json together.

The archive reflects the source available during this repair. Review the diff for newer changes already on GitHub before committing; resolve any overlap rather than replacing newer work blindly. The ZIP contains no runtime data, secrets or node_modules. Do not add your .env, token files, database exports or /data backups to Git.

After the checks pass and you have reviewed the changes:

```bash
git add -A
git diff --cached --stat
git commit -m "Stabilize league isolation and recovery in RC6"
git push -u origin fix/rc6-stability
```

On GitHub, open a pull request from **fix/rc6-stability** into **main**. Wait for the complete CI job, including PostgreSQL, to pass. Do not push straight to main merely to bypass an integration failure. GitHub credentials and repository permissions remain your account's responsibility; nothing in this package grants access.

## Railway staging configuration

Use a separate staging Discord application/token and test server, a separate PostgreSQL database, a separate Redis service and a separate volume. Do not run staging with the production Discord token or production data connections. Keep one bot replica in each environment.

In the staging bot service, select this GitHub repository and the **fix/rc6-stability** branch. Use the included Dockerfile and railway.json. Review these settings:

| Setting | Value |
| --- | --- |
| Start command | `sh scripts/railway-start.sh` |
| Pre-deploy command | `npm run prisma:migrate:deploy` |
| Pre-deploy timeout | 300 seconds initially; increase if tested migrations require more |
| Healthcheck path | `/ready` |
| Healthcheck timeout | 300 seconds |
| Replicas | 1 |
| Volume mount | `/data` |
| Restart policy | On failure, as configured in railway.json |
| Serverless sleeping | Disabled |

Prisma migrations run in the pre-deploy command. Keep RUN_PRISMA_MIGRATIONS_ON_BOOT=false so there is one migration owner. The alternative is to use the boot migration flag with no pre-deploy migration; do not configure both casually. Never use `prisma migrate reset`, `db push --accept-data-loss`, or delete tables as a deployment shortcut.

Set these in Railway **Variables**, not in a terminal or committed .env file:

| Variable | Value |
| --- | --- |
| APP_ENV | `production` even for staging, to exercise persistence guards |
| RELEASE_CHANNEL | `release-candidate` |
| RELEASE_VERSION | `21.10.0-rc.6` |
| BOT_DATA_DIR | `/data` |
| DATABASE_URL | Reference the staging Postgres service DATABASE_URL |
| REDIS_URL | Reference the staging Redis service REDIS_URL |
| DISCORD_TOKEN | Separate staging bot token |
| CLIENT_ID | Staging Discord application ID |
| GUILD_ID | Test server ID |
| COMMISSIONER_ROLE_ID | Test server commissioner role ID |
| ENABLE_QUEUE_WORKER | `true` |
| RUN_PRISMA_MIGRATIONS_ON_BOOT | `false` |
| RUN_DB_BOOTSTRAP_ON_BOOT | `false` |
| RUN_JSON_MIGRATION_ON_BOOT | `false` |
| AI_ENABLED | `false` for initial infrastructure checks; enable with a real key for AI acceptance |

Use Railway service references such as `${{Postgres.DATABASE_URL}}` and `${{Redis.REDIS_URL}}`, substituting your actual service names. Do not copy the placeholder credentials in the example file. Confirm the mounted volume is writable by the container user. Setting a path does not create or verify a persistent mount.

The schema check must succeed before the bot starts. If migrations report conflicting legacy values or unfinished history, keep the deployment stopped and inspect a backup copy. Do not mark migrations as applied blindly. Pre-deploy containers have no application volume; any approved import of existing JSON must be performed with the mounted volume in the application environment after backup.

## Staging acceptance

Record the commit SHA, deployed version and results for each exercise. Check logs as well as visible Discord output.

1. Create two leagues and one event concurrently. Verify three combined slots, separate categories, readable member roles, plain channel names and rejection of a fourth space.
2. With non-admin test accounts, join only A, only B, both, and neither. Verify actual channel visibility and posting access. Discord Administrator bypasses overwrites, so an admin account cannot prove privacy.
3. Give A and B the same team names. Claim, change identity, post scores and adjust streams in each. Verify the other space's team, schedule, standings and cooldown are unchanged.
4. Post and retract the same score repeatedly. Restart; compare standings and lifetime records. Award a member, remove them from the server, rejoin with the same Discord ID, then archive/delete the league. Earned history must remain.
5. Switch template and template options. Unchanged obsolete bot-owned channels should be removed; renamed, moved, retopiced and manual lookalikes should remain for review. Category deletion requires safe ownership and no remaining manual children.
6. Remove the bot's permission during membership grant, build and deletion. Verify explicit failure, no success message, repair state retained, then restore permission and retry/restart. Do not perform fault injection in production.
7. Post active checks in two leagues, make one post fail and join a member after a successful post. Verify only the actual notified audience can miss a check; removal affects that league alone. Restart during a pending removal and confirm it resumes safely.
8. Reach a stream milestone, repeat the source message, post again inside cooldown and restart. Verify no duplicate reward or cooldown bypass. Manual progress reset must retain earned lifetime awards.
9. Confirm native names do not flip when moving between communities. Exact recorded old bot assignments may be cleared; manual names stay. Verify commissioner hierarchy limitations produce a visible actionable outcome.
10. Stop the worker process in staging. The supervisor should exit and Railway should restart the service. Interrupt Redis/Postgres connectivity and Discord connection; `/ready` must fail while a required dependency is unavailable. Restore access and verify recovery without double credit.
11. Inspect `/ready` after restart: current version, current SHA when supplied by Railway, fresh timestamp, Discord/database/queue true. `/health` only establishes that the sidecar is alive. Configure an external monitor for continuing `/ready` checks because Railway's deployment healthcheck is not continuous monitoring.
12. Exercise the real provider/webhook import and AI confirmation workflow you use, including invalid payloads and unavailable-provider responses. Advance shadow mode should remain enabled until provider-specific staging checks pass.

## Production and recovery

Before production: retain the current Git SHA, make verified PostgreSQL and /data backups, rehearse restoring both to isolated staging, and pause scheduled mutation/advance jobs during the deployment window. Drain or stop the old worker before the new deployment accepts writes. Keep production connected to main; merge the reviewed pull request only after CI and staging acceptance pass.

After deployment, verify the expected SHA/version, schema readiness, three-space isolation, existing history and one representative result/award. Resume automation only after these checks. Monitor errors, memory growth, queue failures and `/ready` through a complete scheduled cycle, including cooldown and inactivity behavior.

If problems arise, stop new mutations and preserve an incident snapshot before changing versions. RC6 introduces authoritative result/standings and stream records inside the lifetime document. Running RC5 after RC6 and then returning to RC6 can leave conflicting old/new authorities if either version accepted writes. A blind code-only rollback is therefore unsafe after mutations. Restore a matched pre-release code/database/volume backup, or reconcile post-release events into the chosen authority on a copy and validate before reopening. Retain the incident snapshot so valid member history can be recovered.

## Remaining engineering work

These changes repair the reproduced failures; they do not justify a promise of zero possible regression. The compatibility JSON layer still includes asynchronous best-effort writes and legacy state consumers. Some noncritical sends still suppress Discord errors. Do not horizontally scale while those projections and scheduled jobs lack a complete distributed ownership contract.

The lifetime document grows as a guild's history grows and is locked per guild for mutations. Measure serialized size, mutation latency and backup recovery time under realistic traffic. A future additive migration can move members, results, awards, statistics and audit events into indexed normalized tables with immutable source IDs and explicit revision history. Preserve old records, compare aggregate totals, prove idempotent replay and only then cut readers over. Do not combine that migration with this fault repair release.

Older unattributed data cannot be assigned confidently to a person after ownership changes. Keep unresolved records for commissioner review with evidence; never invent historical winners or erase disputed data. Categories within one Discord server cannot supply independent native nicknames. Different team identities should remain contextual bot content or profiles.

Further release gates: full backup restore rehearsal, service outage testing, worker backlog/order checks, provider-specific round trips, sustained load/heap observation, permission review after manual Discord edits and external readiness alerting. The local suite tests selected failure paths; every third-party service and every Discord permission branch has not been fired live.

## Sources and evidence

- `tests/rc6Faults.test.js`, `tests/auditV204.test.js`, `tests/templateFallbacks.test.js`, `tests/results.test.js` and the existing provider/advance tests.
- `tests/postgres.integration.js` and `.github/workflows/ci.yml` define the pending networked PostgreSQL gate.
- `docs/RC6_DEPENDENCY_MAP.md` records edited owners and caller boundaries.
- `docs/verification/` contains local release and static evidence for this package.
- Railway pre-deploy commands: https://docs.railway.com/deployments/pre-deploy-command
- Railway deployment healthchecks: https://docs.railway.com/deployments/healthchecks
- Railway branch/environment configuration: https://docs.railway.com/overview/advanced-concepts

Railway documentation was checked on 27 September 2026. Preserve this release's verification record; older audit reports describe their own baseline and test counts.
