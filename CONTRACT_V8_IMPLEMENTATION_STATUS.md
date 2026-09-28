# NOFUNBOT Contract v8 Implementation Status

This build implements the **current executable G0/G1 contract foundation** from the v8 Master Implementation Contract while keeping future G2/G3 work disabled until its domain models are implemented and verified.

## Implemented in this build

### G0 integrity
- Centralized autocomplete response lifecycle with exactly one autocomplete response attempt and incident telemetry.
- Canonical league resolver with explicit selectors for joinable, operational, resettable, provider, progression, diagnostic/history, event, and deletable scopes.
- High-integrity team commands carry explicit league scope and re-resolve league/team at execution time.
- `/select-team` is league-scoped and converges on the canonical team-assignment application use case.
- Natural-language team assignment also converges on the same application use case instead of mutating team state directly.
- Commissioner add-member flow preserves valid membership when optional team assignment fails and records `AWAITING_TEAM`.
- Clean-slate reset clears functional member/onboarding/session/media/scheduler state rather than leaving rehydratable member history behind.
- Internal custom-emoji keys no longer leak into user-visible fallback text.
- Static release gate rejects StringSelectMenuBuilder, always-true `|| true`, duplicate Anthropic Promise.race timeout ownership, and direct natural-planner team mutation.

### G1 public-beta foundation
- Production bot-rendered StringSelectMenuBuilder count is zero. Choice UI uses buttons backed by server-side ComponentSession state.
- Component sessions bind actor/guild/flow, expire, fail closed after restart, and keep canonical option values server-side.
- Workflow definitions report truthful wiring state (`wired`, `manual`, `dormant`) rather than registration implying a live trigger.
- AI requests use one runtime orchestrator for cancellation, timeout and retry policy.
- R-mode Open House engagement policy is channel-aware, cooldown/burst-limited, opt-out aware, and preserves hard competitive banter while excluding operational lanes.
- Media analysis uses bounded global/per-guild concurrency controls.
- Pacific business scheduling uses IANA timezone calculations rather than fixed PST math.
- POTW delayed work is represented by durable due-at intent and is re-armed through SchedulerRegistry.
- Central secret redaction is applied to logging/incident paths added by the contract implementation.
- Poll button rendering bug found by the undefined-identifier scan was corrected.

## Additional league-scope convergence in this package

The following commands now carry explicit league identity instead of relying on encoded `team::leagueId` display values or ambient state:

- `/register-team`
- `/set-team-identity`
- `/add-open-team`
- `/remove-open-team`
- `/set-team-logo`
- `/release-team`
- `/create-game`
- `/report-result` when not already inside a scoped game channel
- `/teams assign`
- `/teams free`

Autocomplete remains a convenience only. Execution re-resolves canonical league and team identity before mutation.

## Deliberately not claimed complete

Contract v8 is a master roadmap, not a promise that all 113 pages become production code in one patch. The following remain later gate work and are **not silently enabled** here:

### G2 progression/postseason
- Canonical PostgreSQL Season / ProgressionPolicyVersion / TierAssignment / ProgressionGrant / ProgressionWallet / ProgressionClaim / PlayerMutation / MembershipTenure / PostseasonBracket models.
- Tier random/basic/manual engines.
- Initial dev-trait and age-reset grants.
- Member-earned reward wallets and forfeiture rules.
- Commissioner attribute point caps and physical/skill attribute policy engine.
- Full postseason builder and bracket automation.

### G3 scale/refactor
- Full router decomposition into command/controller registries.
- Full removal of compatibility JSON authority after PostgreSQL cutover.
- Multi-instance component/session storage and distributed dedupe.
- Retirement of all legacy synthetic-select compatibility handlers.
- Full dependency-cycle elimination and service-boundary refactor.

These are tracked in the bundled v8 contract and should be implemented behind migrations/feature flags rather than partially activated.

## Validation performed in the artifact environment

- `node --check`: all shipped JavaScript files pass syntax validation.
- `scripts/contract-v8-static-check.js`: passes.
- `scripts/check-undefined-identifiers.js`: passes after fixing a poll UI undefined identifier.
- `tests/contractV8.regression.test.js`: 9 passed, 0 failed using a minimal Discord test stub for the contract-specific checks.

A clean `npm ci` could not complete in the artifact container before its network timeout, so the **full dependency-backed suite must be run on the target Mac/CI environment before deploy**.

## Required clean-extraction gate

```bash
npm ci
npm test
npm run tsc
npm run release:verify
npm run deploy:preflight
```

Do not deploy if any gate fails.
