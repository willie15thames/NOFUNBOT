# Codebase Navigation

## Fast path
- `index.js`: app bootstrap and top-level event listeners
- `src/routing/`: event and interaction dispatch
- `src/handlers/`: message / mention / user-facing consumption paths
- `src/services/`: most business logic and safety controls
- `src/microservices/`: long-running orchestration paths
- `data/`: runtime JSON state and configuration snapshots
- `prisma/`: database schema / migration / seed

## Read order
1. `index.js`
2. `src/routing/`
3. `src/handlers/`
4. `src/services/response*`, `*guard*`, `*state*`, `*wizard*`
5. `src/services/personaArbiterService.js`, `responseLifecycleService.js` (V184 routing core)
6. `src/services/observabilityService.js`, `validationGateService.js` (V184 operational proof)
7. `src/microservices/`
8. `scripts/` and `PATCH_*.md`

## V184 Reliability Hardening — key new services
- `personaArbiterService.js` — single-persona decision engine (IT > Comm > Member)
- `responseLifecycleService.js` — standardized response pipeline
- `observabilityService.js` — flow metrics, claim tracking, health reports
- `stateOwnershipMapService.js` — field → service ownership map
- `roleHierarchySyncService.js` — expected vs actual role hierarchy audit + reconcile
- `recoverySelfHealService.js` — expanded: 5 targets + full startup sweep
- `validationGateService.js` — expanded: 8 validators + composite preflight
- `workflowRegistryService.js` — expanded: 13 registered flows with priority

## Red-flag areas
- duplicate execution / dedupe / claims
- wizard state vs preferences state
- message send / reply / followUp / editReply
- patch-notes publishing and privacy
- multi-instance behavior relying on Redis/event claims
- persona routing (now centralized in personaArbiterService)

## V202 League control plane — where things live
- `src/league/advanceEngine.js` — the ONE week-advance authority (state machine, prechecks, verify, import, validate, publish). Start here for any "why didn't the week advance" question: `/game-channels advance-status`.
- `src/league/runtimeService.js` (`leagueRuntime.json`) — advance state, workflowWeek vs sourceWeek, deadlines, hold, cycle ids, legal transitions.
- `src/league/automationPolicyService.js` (`automationPolicy.json`) — enabled / intervalHours / shadowMode / precheck + retry policy.
- `src/league/gameSessionService.js` (`gameSessions.json`) — durable game-channel sessions; rehydrated on boot.
- `src/league/gameResultService.js` (`gameResults.json`) — single owner of results + standings application.
- `src/league/importRunService.js` (`importRuns.json`, `importArtifacts.json`) — durable provider receipts, idempotency.
- `src/league/canonicalModel.js`, `src/league/validationService.js` — matchupKey + canonical game, import validation.
- `src/providers/` — provider adapters (`gameProvider.js` contract + registry; `local`, `customEndpoint`, `madden/{companion,neonsportz,ea}`, `nba2k`). Capabilities are explicit; no provider has advance control.
- `src/services/leagueAutomationService.js` — single wake-up timer (not the authority). `leagueSyncService.js` — sync-now/sync-status. `providerService.js` — active provider.
- `src/actions/` — AI Action Catalog (`actionCatalog.js` single source of truth), `actionValidator.js`, `actionExecutor.js`, `confirmationService.js`.
- `src/ai/commissionerPrompt.js` — builds the runtime prompt from `docs/ai/NOFUNLEAGUE_COMMISSIONER_AI_RUNTIME_v2.txt` + the generated catalog.
- `src/http/providerHttpServer.js` + `routes/` — Companion export / NeonSportz webhook receiver (ENABLE_PROVIDER_HTTP, off by default).
- `src/utils/httpIntake.js` — the only way to fetch external URLs. `src/utils/csv.js` — RFC 4180 CSV.
- `tests/` — `npm test` (isolated BOT_DATA_DIR per file, no tokens needed).

### V202 red flags
- Never write `lastAdvancedWeek` / publish a week outside `advanceEngine` — projection code (`weeklyAutomationService.projectCurrentWeek`) must stay idempotent and side-effect-only.
- Never add an AI action type in prompt text — add it to `actionCatalog.js` with an executor and a test.
- Never call `fetch` directly — use `httpIntake.fetchExternal`.

## V203 Command registry
- `src/services/commandAliasService.js` — GROUPED_ALIASES: legacy commands nested into existing groups (registration + routing from one spec). Add a command to a group here; never add a new top-level command.
- `docs/COMMAND_ARCHITECTURE.md` — verified command counts, restored paths, legacy routes, consolidation plan.
