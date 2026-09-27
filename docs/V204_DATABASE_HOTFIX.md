# V204 database table alignment hotfix

Package 21.10.0-rc.3 includes the RC2 database correction and an explicit storage-directory guard.

## RC3 storage guard

When BOT_DATA_DIR is set, the JSON compatibility store now fails startup if that directory cannot be created or written. It cannot silently fall back to ./data or /tmp and begin writing to a different location. An unset BOT_DATA_DIR retains the prior local development fallback. The Railway start script still requires a writable /data mount; a new empty mount does not import files from a former ephemeral directory. Two focused tests cover rejection and use of a valid configured directory.

## Dependency map and scope

Prisma maps BotKv to PostgreSQL bot_kv and QueueAudit to queue_audit. Migration 20260318_v109_full_schema renames the initial mixed-case tables. criticalStore, jsonStore, the queue worker, JSON import/export and schema readiness still reference mixed-case names. These paths must use the same tables as Prisma; their function signatures and message dedup remain unchanged.

Affected code: src/storage/criticalStore.js, src/storage/jsonStore.js, src/queue/worker.js, scripts/{schema-readiness,db-bootstrap,migrate-json-to-postgres,export-postgres-to-json}.js. Add an additive reconciliation migration and extend tests/postgres.integration.js. CI remains responsible for fresh-database migrations plus real PostgreSQL tests.

## Data preservation

The new migration copies legacy BotKv rows only when their key is absent from bot_kv or the JSON value is identical. Divergent values for the same key stop the migration with an actionable error. Both original tables remain intact. Resolve a conflict using backed-up records and operator review; never guess which lifetime record is authoritative. Legacy QueueAudit rows remain in their original table as an archive; future writes use queue_audit. Stop the old bot and worker writers before cutover.

The old db:bootstrap entry point now executes committed Prisma migrations instead of recreating incompatible tables. Existing applied migration files remain unchanged. No db push, reset, drop, truncate or deletion is used.

## Railway recovery

1. Back up PostgreSQL and export the current JSON data before replacing the running container. A new /data volume does not move existing ./data files automatically.
2. Confirm the service source is willie15thames/NOFUNBOT and the intended fixed commit. The provided screenshots show Node 20 and 90-minute uptime; this differs from the current Node 22 Dockerfile and suggests an old or differently built deployment.
3. Test migrations on a restored staging database first. Configure the pre-deploy command as `npm run prisma:migrate:deploy && npm run schema:check`. Keep RUN_PRISMA_MIGRATIONS_ON_BOOT=false when using this pre-deploy command; keep RUN_DB_BOOTSTRAP_ON_BOOT=false and RUN_JSON_MIGRATION_ON_BOOT=false.
4. Attach a persistent volume at /data, preserve/copy the prior JSON files through a controlled migration, and set BOT_DATA_DIR=/data. Ensure the runtime bot user can write the mounted directory.
5. Use the repository Dockerfile, start command `sh scripts/railway-start.sh`, and healthcheck `/ready`. Deploy the fixed commit. Verify Node 22, package version/commit, schema readiness and fresh uptime before running setup commands.
6. If Prisma reports an existing unbaselined database, unfinished migration or conflicting legacy keys, stop and inspect that exact error. Do not run db push or mark migrations applied without verifying the actual schema and data.

The diagnostic text does not prove that no tables exist. A failed schema probe means required tables/columns could not be read. Channel counts may reflect a partial build or template-specific expectations; do not create guessed channel names. RC4 removes the two-character text-channel prefix for new league channels; existing names remain supported. The AI prose/JSON parse failure is a separate symptom; no action was executed in that screenshot.

## Verification

Local: 88 checks across 13 files pass; TypeScript configuration and syntax of every changed JavaScript file pass. Real PostgreSQL fixtures are included for canonical table agreement, concurrent writes, rollback, connection reopen, JSON compatibility writes, legacy preservation, idempotence and conflicting-value refusal. The GitHub CI result must be checked before merge. No production migrations or Discord operations were performed.

Additional validation: all six SQL migrations executed successfully in PGlite, an embedded PostgreSQL engine. Required canonical tables, legacy-history preservation, repeat reconciliation, conflict refusal and transaction rollback passed. This does not replace the networked PostgreSQL/Prisma/queue integration gate. RC2 is on the remote fix/v204-postgres-table-names branch; RC3 is local and has not been pushed, tested by GitHub CI or deployed.
