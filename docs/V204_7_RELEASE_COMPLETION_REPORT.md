# NOFUNBOT v204.7 Release Completion Report

Status: **production-candidate implementation complete; clean-environment dependency/TypeScript/full-suite certification still required before production promotion.**

Version: `21.11.0-rc.3`

## What this release closes

v204.7 turns the RC1 planning contract into executable code across conversation intelligence, natural-language planning, server structure, provider connections, provider durability/recovery, and regression ownership.

### Conversation intelligence

Implemented:

- explicit @mention speech gate for commissioner/member/IT conversational AI;
- bounded, memory-only, channel-local passive context;
- no AI call, typing, reaction, reply, mutation, or persistence from passive observation;
- ambient context redaction and staff/ops channel exclusions;
- message update/delete synchronization for ambient memory;
- short-lived pending natural-action clarifications scoped by guild+channel+user;
- fresh natural requests clear stale pending state;
- live entity/state revalidation before mutation;
- deterministic planner executes before AI quota/fallback.

### Broadened natural planner

Natural planning is an adapter into registered actions/domain services, not a second business-state authority. Supported deterministic intents include:

- team assignment and release;
- league status and open-team refresh;
- ban list;
- workflow week release / hub week updates;
- advance dry-run/request through the advance engine;
- automation enable/disable/configuration;
- channel/category/role management through registered action ownership;
- rules update;
- provider status, sync-now, connection test, activation, disconnect, reconnect, and manual fallback.

Destructive actions retain permission and confirmation policy.

### Server structure model

The previous Empty/Base ambiguity is removed.

- **Base Structure**: no template or subtemplate selection. Core server/bot lanes only.
- **Template Structure**: exactly one template plus a relevant built-in subtemplate when applicable.
- **Custom Structure**: commissioner-selected templates and optional subtemplates, deduplicated before creation.

No hidden gaming-template fallback remains for Base. Validation, hierarchy enforcement, base initialization, rendering, and template mixing are structure-aware.

A General/Simple family provides lightweight Community Chat, Gaming, Sports, Study Group, and Watch Party layouts.

### Provider connection control plane

Implemented:

- league-scoped `ProviderConnection` records;
- explicit provider connection lifecycle states;
- encrypted provider secrets (AES-256-GCM derived from host secret material);
- hashed push-receiver route tokens;
- durable `ProviderSyncRun` lifecycle;
- durable `ProviderImportReceipt` with database idempotency;
- one authoritative active/degraded external provider per league;
- manual fallback without deleting configuration;
- reconnect/token rotation and disconnect behavior;
- recovery hydration and interrupted-run recovery;
- Companion Direct, NeonSportz, Custom Endpoint, and local/manual paths;
- public provider ingress through the primary health/public HTTP service;
- data projection that never advances workflow week merely because source data changed.

### P0 audit closures

1. **Stale natural-planner member contamination**
   - Fresh requests no longer inherit a stale pending member ID.
   - Pending resolution is bounded and only used for genuine continuation.

2. **Provider 2xx-before-durability window**
   - Push receivers synchronously create a durable receipt/artifact before returning success.
   - Production defaults require database-backed provider receipts unless an explicit compatibility override is enabled.
   - Background processing no longer determines whether the upstream acknowledgement was truthful.

### Additional audit closures

- Companion payload limit aligned to 6 MB through intake/artifact stages.
- Recovery is not limited to the newest 50 receipts.
- Managed Companion tokens route to an exact league; wrong/unknown tokens fail closed.
- NeonSportz managed webhook path no longer depends on a shared-secret header that the modern workflow may not provide; route-token + delivery-id validation is authoritative.
- NeonSportz read side supports configured resources/pagination/retry rather than assuming one snapshot endpoint.
- Non-schedule Companion stages can be normalized/projected to provider data snapshots.
- Custom HTTPS/JSON is a first-class connection using the same control plane.
- Conditional GET support (`ETag`, `Last-Modified`) is available for custom pull sources.
- Provider 429/5xx retry and stale-revision protection are covered by focused regression tests.
- Trade proposal/decision state is owned by `tradeWorkflowService`, persisted immediately, league-scoped, and single-consume on decision.
- Static undefined-identifier regression in setup-community hierarchy validation was fixed.
- README and deployment examples are updated.

## Regression evidence executed in this build environment

Focused tests passed during implementation:

- `tests/structureSemantics.regression.test.js` - 7 passed
- `tests/conversationAwareness.test.js` - 10 passed
- `tests/speechGate.regression.test.js` - 4 passed
- `tests/naturalPlanner.regression.test.js` - 36 passed
- `tests/providerDurability.regression.test.js` - 11 passed
- `tests/providerFaults.regression.test.js` - 8 passed
- `tests/providerContract.regression.test.js` - 11 passed
- `tests/messageRouting.regression.test.js` - 7 passed
- `tests/tradeFlow.regression.test.js` - 6 passed
- project JavaScript syntax sweep - **238 files passed** in RC3
- unresolved executable identifier guard - passed when last run

These targeted suites are included in the release ZIP.


### RC3 release-closure hardening

- Provider connection durability recognizes `APP_ENV=production` as a production gate, not only `NODE_ENV=production`.
- Unscoped provider resolution fails safe to local/manual when multiple leagues exist.
- League-scoped provider connection lifecycle no longer writes the legacy global provider as authority.
- Natural planner now also handles deterministic rule replacement through the registered `update_rules` action.
- Focused regression count is **100 passed, 0 failed** across the v204.7 closure suites.

## Clean-environment certification still required

The current build environment could not complete a fresh `npm ci` because dependency installation timed out. That prevents truthful certification of the full historical suite, TypeScript compile, Prisma CLI validation, and aggregate release scripts here.

Before production promotion, run on the developer Mac or CI with package-registry access:

```bash
npm ci
npm run prisma:generate
npm run prisma:migrate:deploy
npm test
npm run tsc
npm run release:verify
npm run deploy:preflight
```

Do not skip failures. Fix code/tests rather than weakening a historical regression assertion merely to obtain green output.

## Required staging trial

After the command-line gates pass, validate in a non-production Discord guild/database:

1. Base setup creates no selected template/subtemplate.
2. Template mode creates one chosen family/subtemplate.
3. Custom mode composes multiple selected template/subtemplate sets without duplicate names.
4. Normal unmentioned conversation generates no bot output and no AI call.
5. A later explicit @mention can use recent same-channel context.
6. `@myBot put Paul on the Ravens` executes when member/team/league are unique.
7. Duplicate Ravens across leagues produces a league clarification and no mutation.
8. Fresh `Sam/Jets` request cannot inherit prior Paul/Ravens clarification state.
9. Slash-command team assignment still uses the same domain path and rollback semantics.
10. Trade proposal/approve/decline survives process restart and duplicate decisions are no-ops.
11. Companion receiver accepts a valid league route token, persists receipt/artifact, returns success, and recovery can process after restart.
12. Duplicate provider delivery is idempotent.
13. Malformed/wrong-league/stale provider payloads fail safe.
14. NeonSportz 429/5xx retry path does not mutate workflow week.
15. Custom URL 304/ETag path leaves canonical data stable.
16. Provider manual fallback restores local/manual behavior without deleting connection configuration.
17. Startup recovery does not treat passive chat memory as durable state.
18. Existing game channel, stream, setup edit-mode, and advance-engine regressions remain green.

## Production configuration gate

- PostgreSQL reachable and schema migrated.
- Redis reachable when queue worker is enabled.
- persistent `BOT_DATA_DIR` mounted and writable.
- `PUBLIC_BASE_URL` is the real HTTPS bot origin.
- `ENABLE_PROVIDER_HTTP=true` when push providers are used.
- `PROVIDER_SECRET_KEY` is non-placeholder, high-entropy secret material.
- JSON provider durability overrides remain false in production unless intentionally accepting degraded compatibility behavior.
- provider receiver URLs/tokens are treated as secrets.
- `ENABLE_TRASH_TALK_LEARNING=false` unless an explicit privacy/retention decision is made.
- Direct EA provider remains disabled unless a legitimate authorized interface is available.

## Rollback

Keep the prior production package/image available through the trial window. Provider connection records and local/manual source mode allow provider features to be placed into fallback without deleting league configuration. Do not roll back database migrations by deleting tables during an incident; roll application code back first and preserve provider receipts/sync-run evidence for recovery.

## One-command clean release gate

v204.7 includes:

```bash
npm run release:v2047:final
```

That script performs the clean dependency install, Prisma client generation/schema validation, full test suite, TypeScript validation, aggregate release verification, and deployment preflight. It deliberately does not auto-apply production database migrations. Apply migrations as a controlled deployment step with `npm run prisma:migrate:deploy` against the intended database after the gate passes.
