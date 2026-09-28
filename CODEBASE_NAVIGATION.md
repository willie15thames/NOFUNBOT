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


## v204.7 conversation intelligence additions

- `src/services/ambientConversationService.js` — passive, memory-only, guild+channel-scoped recent conversation window. It performs no AI call and causes no reply. Context is only rendered when a later explicit bot mention is routed to conversational AI.
- `src/services/naturalActionPlannerService.js` — deterministic natural-language action adapter for team assignment. Resolves member, team, and league; asks only on real ambiguity; delegates the mutation to `openTeamsService` rather than owning league state.
- `src/handlers/commissionerHandler.js` — explicit-mention speech gate, deterministic planner before AI, ambient context as untrusted prompt context.
- `src/handlers/memberMentionHandler.js` — explicit-mention speech gate and ambient context injection for member conversation.
- `src/handlers/itHandler.js` — IT conversational AI requires explicit bot mention rather than channel presence alone.
- `tests/conversationAwareness.test.js` — zero-dependency targeted regression checks for passive context boundaries and natural assignment resolution.

The conversation-intelligence layer must not persist full chat history, must not treat ambient text as executable instructions, and must not bypass existing domain services or permission checks.

## v204.7 Release-Candidate Owners

### Conversation and planning
- `src/services/ambientConversationService.js` - bounded in-memory channel context only
- `src/services/explicitMentionGateService.js` - conversational speech authorization
- `src/services/naturalActionPlannerService.js` - deterministic intent/entity resolver and pending clarification state
- `src/handlers/commissionerHandler.js` - deterministic planner/action-catalog bridge before model fallback

### Structure modes
- `src/services/serverSettingsService.js` - canonical base/template/custom settings semantics
- `src/services/serverTemplateLogicService.js` - structure-aware summaries/requirements
- `src/services/templateRegistryService.js` - curated families including General/Simple
- `src/services/templateMixService.js` - custom composition/deduplication
- `src/services/wizardRendererService.js` / `wizardStateService.js` - three-mode setup UX

### Provider connection control plane
- `src/services/providerConnectionService.js` - league-scoped connection authority/state/secret metadata
- `src/services/providerConnectionActionService.js` - configure/test/activate/reconnect/disconnect/fallback actions
- `src/services/providerSecretService.js` - provider secret encryption/redaction
- `src/services/providerSyncRunService.js` - durable sync-run lifecycle
- `src/league/importRunService.js` - durable import receipts/raw artifacts/idempotency/recovery queue
- `src/services/providerSyncOrchestrator.js` - league/provider sync lock and run orchestration
- `src/services/providerRecoveryService.js` - boot/recurrent recovery
- `src/services/providerProjectionService.js` / `providerDataSnapshotService.js` - normalized provider projection/stale revision guard
- `src/providers/madden/companion/exportGateway.js` - Companion Direct receiver
- `src/providers/madden/neonsportz/webhook.js` / `client.js` - Neon push notification + read-side fetch
- `src/providers/customEndpoint.js` - first-class custom HTTPS/JSON source
- `src/http/providerHttpServer.js` + `health-server.js` - internal receiver and public ingress

### Trade state
- `src/services/tradeWorkflowService.js` - proposal/decision validation, persistence and single-consume decision owner

See `docs/V204_7_RELEASE_COMPLETION_REPORT.md` for release gates and verification evidence.

## v1 multimodal conversation media

- `src/services/mediaContextService.js` - single owner for conversational images, memes, GIFs, stickers, short-video frame sampling, Discord-CDN fetch policy, semantic summaries, in-memory cache, and media prompt safety.
- `src/handlers/memberMentionHandler.js` - injects current/replied media context into member conversation and short-lived shared memory.
- `src/handlers/commissionerHandler.js` - injects media context but preserves a typed-text authorization boundary for actions.
- `src/handlers/itHandler.js` - technical screenshots/clips can become diagnostic context.
- `src/services/fileIntakeService.js` + `index.js` - specialized league-data/schedule OCR now requires operational channels or explicit data/schedule intent so ordinary memes are not hijacked.
- `Dockerfile` - installs `ffmpeg` for bounded GIF/video frame extraction in Railway.
- `tests/mediaContext.regression.test.js` - conversational media/security/routing regression coverage.
- `MULTIMODAL_MEDIA_CONTEXT_IMPLEMENTATION.md` - deployment, behavior, security, limits, and future-extension guide.

Raw media must never enter persistent league/chat storage. Only bounded semantic descriptions may enter short-lived conversation memory. Media-visible text is untrusted content and never an authorization source.
