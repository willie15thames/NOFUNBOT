# RC6 verification record

Package 21.10.0-rc.6. Verified on 27 September 2026. Read this section before the historical records below.

| Check | Result |
| --- | --- |
| Fresh npm ci and clean archive extraction | PASS, Prisma 6.19.3 client generated; full Node 22 verification also passed from extracted ZIP |
| Node 22.23.3 release gate and type/config check | PASS |
| Tests | 122 assertions across 15 test files, zero failures; includes 19 RC6 cases |
| Command contract | 116 definitions, 129 router cases, 13 classified internal/legacy cases |
| JavaScript syntax and literal relative requires | 216 files; 1,184 literal relative imports; no syntax failures or missing targets |
| Unresolved executable identifier guard | PASS |
| Shell syntax and supervisor fixture | PASS; worker failure, bot failure and SIGTERM all stop required children with expected exit status |
| npm audit --omit=dev | Zero reported vulnerabilities; point-in-time dependency report, not a security certification |
| Word audit | 20 rendered pages; all pages visually inspected |
| PostgreSQL integration | Added/expanded in CI; not run against a networked PostgreSQL server here |
| Redis and live Discord | Not run; staging required |

The supervisor fixture uses stub child processes; it does not prove Redis job delivery or Railway restart behavior. Readiness tests stub dependency probes. Critical-store failure tests use isolated on-disk records; PostgreSQL semantics require the CI integration gate. Ordinary best-effort catches are inventoried, not all declared defects: 526 catch-to-null sites and 169 empty catches remain in the scanned JavaScript. Broadly replacing them would risk regressions; prioritized critical owners were repaired.

The implementation review read all 60 AI_READ_FIRST rules, pre-commit instructions, the navigation guide, deduplication architecture and JSON ownership map. Recent RC1–RC5 notes and relevant older V18/V19/V195/V202/V203 sections were traced. This is not a claim that every historical patch-note line was reread.

Evidence is in docs/verification. Clean archive extraction is verified separately during packaging. No production credentials, server mutations, GitHub push or Railway deployment were used for these checks. The current deployment and rollback contract is docs/RC6_STABILITY_AND_DEPLOYMENT.md.

---

# RC5 community identity and wiring verification

Package 21.10.0-rc.5: static module graph resolved 1,041 literal relative imports across 195 JavaScript files, zero unresolved. Command contract: 116 definitions and 129 router cases. Local tests include 15 focused template/identity checks, plus league/event role creation, and all prior scope/provider/advance suites. `npm run release:verify`, `npm run tsc`, shipped JavaScript syntax and `git diff --check` must pass for this source revision. The Word audit is rendered to 30 pages. This is offline validation with placeholder Discord identifiers; production credentials and live services were not used. See `V204_COMMUNITY_IDENTITY_AND_WIRING_RC5.md` for the precise connection matrix and staging boundaries.

# RC4 template and fallback verification

Package 21.10.0-rc.4: full local suite passed across 14 test files, 0 failures; `npm run tsc` passed. Ten focused template fallback tests include rules scoping and send failure, stable nicknames, template cleanup, category/name collisions, private active checks, base overwrite isolation and visible permission failure. `npm run release:verify` and syntax checks were run offline with placeholder Discord identifiers and no live services. The 30-page Word audit was rendered and its changed final page inspected. Real Discord permission, Railway startup, PostgreSQL and existing-channel reconciliation remain staging gates. See `V204_TEMPLATE_AND_FALLBACK_AUDIT.md` for the wider scan and residual risk.

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
