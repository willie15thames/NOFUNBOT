# RC3 storage guard verification

Package 21.10.0-rc.3 adds a configured-directory startup guard. Local suite: 88 checks across 13 files, 0 failures. `npm run tsc` and changed-file syntax checks pass. RC3 has not run on networked PostgreSQL, GitHub CI, Docker or Railway. The RC2 checks below remain the database correction baseline.

# RC2 database hotfix verification

Package 21.10.0-rc.2 corrects mixed-case SQL references left in RC1. See V204_DATABASE_HOTFIX.md. All 86 local checks, changed-file syntax and TypeScript configuration checks passed. All six migrations and preservation/conflict/rollback SQL checks passed in the PGlite embedded PostgreSQL engine. The networked PostgreSQL integration test, GitHub CI and live Railway/Discord checks were not run; GitHub write permission was denied. The record below is the earlier RC1 baseline.

# Verification record

Package: 21.10.0-rc.1. Checked 27 September 2026. Local runtime: Node 24.19.0 and npm 11.9.0. Docker, .nvmrc and CI target Node 22; that runtime and the Docker image were not executed locally.

| Check | Result |
| --- | --- |
| Clean npm ci in an empty temporary directory with package/lock/schema | PASS; 133 packages installed, Prisma Client 6.19.3 generated |
| npm run release:verify | PASS; changelog, doctor, command contract, undefined-identifier guard and full test suite |
| Full suite | 86 checks across 12 files; 0 failures |
| Added behavior checks | 13 checks in auditV204.test.js |
| Command contract | 116 definitions, 129 router cases, 13 classified legacy/internal cases |
| npm run tsc | PASS; existing checkJs=false means this is not full JavaScript type safety |
| node --check on all shipped JavaScript | PASS; 210 files |
| npm audit --omit=dev | 0 reported vulnerabilities at verification time; not a security certification |
| Updated Word audit | Rendered to 29 pages; every page visually inspected |

The first release-check attempt correctly rejected missing DISCORD_TOKEN. The successful offline run supplied placeholder Discord IDs/token, AI_ENABLED=false and an isolated temporary BOT_DATA_DIR. No real Discord credentials were used. Doctor warnings about absent optional PostgreSQL/Redis services are expected in this offline run; production critical writes require PostgreSQL. No live server records, roles or channels were modified.

The previous suite had 74 checks. One obsolete source-string assertion expecting public channels was removed to implement the explicitly requested private-channel model, and 13 behavior checks were added. Provider and advance safety tests remain. Fixtures validate local behavior; passing them does not prove effective Discord permissions or all possible integration paths.

Not run: real Discord API and effective permission checks, Railway/Docker deployment, live PostgreSQL migrations, tests/postgres.integration.js, external provider round trips, production legacy-data migration and backup restore drill. CI now includes a disposable PostgreSQL service and the integration test; inclusion is not evidence of a successful CI run. Remaining engineering work and the exact staging acceptance checklist are in V204_RELEASE_NOTES.md and Sections 26–28 of the updated Word audit.
