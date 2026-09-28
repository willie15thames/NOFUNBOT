# NOFUNBOT Live Interaction, Autocomplete, and League-State Implementation Contract Amendment

## Purpose
This amendment captures live defects reproduced in Discord during the September 27, 2026 test-server run and the codebase-wide controls required before public deployment. It applies to all current and future Discord autocomplete, league selection, team selection, member onboarding, league-state, and team-display paths.

## Live evidence summary
The live screenshots show four connected failure classes:
1. Discord autocomplete panels show **Loading options failed** for `/select-team` and `/add-member-to-league`.
2. A commissioner can manually type a visible league name after autocomplete fails, but `/add-member-to-league` then reports **That league is no longer active** even while that league's channels and a successful team claim are visible.
3. `/select-team` can be completed after manually typing a team even though the command did not retain an explicit league selection.
4. The open-team board can expose raw internal emoji identifiers such as `:1804panthers:` when the expected custom emoji is unavailable.

These symptoms are not independent UI annoyances. They show that interaction lifecycle, canonical league resolution, team scoping, and display rendering are using different contracts.

## Confirmed static-audit findings

### INT-001 - Autocomplete is routed through a chat-reply wrapper that assumes reply methods exist
**Severity:** P0 / release blocking

`src/services/interactionRouterService.js::protectInteraction()` unconditionally binds `reply`, `followUp`, `editReply`, and `deferReply` before the router checks `interaction.isAutocomplete()`. The router's autocomplete implementation correctly uses `interaction.respond()`, but the safety wrapper is entered first.

**Required change**
- `protectInteraction()` MUST be capability-aware.
- Autocomplete interactions MUST bypass chat-input reply wrapping entirely, or only wrap methods that exist.
- The autocomplete path MUST use only `interaction.respond()`.
- Any autocomplete exception MUST be converted into a bounded fallback `respond([])` or a safe option list. It MUST NOT attempt `reply`, `editReply`, `followUp`, or `deferReply`.

**Acceptance tests**
- Use an AutocompleteInteraction-shaped mock that has `respond()` and no reply lifecycle methods.
- Verify every autocomplete-enabled command reaches `_handleAutocomplete()` without throwing.
- Verify fallback behavior returns within the Discord autocomplete response window.

### INT-002 - There is no centralized safe-autocomplete lifecycle
**Severity:** P0

The code has 37 autocomplete declarations in `src/commands.js`, while response logic is distributed across 17 `interaction.respond()` call sites in the router. This creates a large regression surface.

**Required change**
Create a single `autocompleteService` / `safeAutocomplete()` contract that:
- reads focused value safely as a string;
- catches resolver errors;
- enforces maximum 25 results;
- enforces Discord name/value length limits;
- removes duplicate values;
- never returns undefined names/values;
- records command, option, latency, and error fingerprint in runtime incidents;
- always acknowledges autocomplete with `respond()` exactly once.

Add a registry test that enumerates every `.setAutocomplete(true)` declaration and proves it has a responder.

### LEAGUE-001 - Visible league name and canonical league ID are not resolved by one contract
**Severity:** P0

Several handlers read `interaction.options.getString('league')` and then use `activeLeagueService.getLeague(value)` or compare only `league.id`. When autocomplete fails, users naturally type the visible league name, which is rejected even if the league is active.

**Required change**
Add `activeLeagueService.resolveLeagueReference(input, options)` with deterministic resolution order:
1. canonical ID exact match;
2. exact league name match, case-insensitive;
3. optional exact normalized alias match;
4. no fuzzy destructive resolution.

If more than one normalized name matches, return `AMBIGUOUS_LEAGUE`, never silently choose one.

All handlers and autocomplete dependent options MUST use this resolver, including:
- join league;
- add member to league;
- league export receiver URL;
- delete league;
- reset league;
- active-check/status commands;
- provider/sync commands that accept a league identifier;
- future postseason/reward configuration commands.

Error text MUST distinguish `not found`, `archived`, `archiving`, `wrong guild`, and `ambiguous` instead of reporting all failures as "no longer active."

### LEAGUE-002 - `listActiveLeagues()` does not actually enforce active status
**Severity:** P0

`activeLeagueService.listActiveLeagues()` currently returns every record in `activeLeagues.json` without filtering status. At least 32 source consumers rely on this method. Other services separately treat `ACTIVE`, `ARCHIVING`, and missing status differently.

**Required change**
Do not silently redefine the existing function in a way that may regress legacy callers. Introduce explicit selectors:
- `listLeagueRecords()` - all canonical records;
- `listOperationalLeagues()` - ACTIVE and explicitly supported PAUSED states;
- `listJoinableLeagues()` - ACTIVE league records members may join;
- `listResettableLeagues()` - states commissioners may reset;
- `listDeletableLeagues()` - states commissioners may delete/recover;
- `listEvents()` - event records only.

Every call site must be classified and migrated to the correct selector. Guild ID filtering must be part of the selector contract.

### LEAGUE-003 - Fallback league state can masquerade as a canonical active league
**Severity:** P1

`listResetOptions(state)` falls back to `state.leagueConfig` with an artificial ID of `current`. This is useful for legacy recovery but dangerous for member assignment, provider routing, destructive commands, and permissions because it is not necessarily backed by a canonical active-league record.

**Required change**
- Restrict fallback records to explicit recovery/migration surfaces.
- Member join, add-member, team claim, provider receiver, delete/reset, and permission grants MUST require a canonical league record.
- Add a diagnostic that reports legacy fallback state separately from active canonical leagues.

### TEAM-001 - `/select-team` does not carry a first-class league option
**Severity:** P0 for multi-league servers

The current command carries team and timezone, while league scope is encoded inside the autocomplete value (`team::leagueId`). When autocomplete fails and the user types `ravens`, the league component is lost. The router also classifies `select-team` as a global command, so normal channel league context is intentionally cleared.

**Required change**
Recommended command contract:
`/select-team league:<league> team:<team> timezone:<optional>`

Rules:
- In a league-owned channel, the league MAY be pre-resolved and the option can remain optional.
- With exactly one joinable league, the bot MAY infer that single league.
- With multiple eligible leagues and no channel scope, league is required.
- Team autocomplete MUST be dependent on the resolved league and return only open teams from that league.
- The final confirmation MUST show league, team, timezone, and ownership status.
- Manual team input MUST resolve only inside the resolved league.

Do not rely on display strings containing `::` as the long-term identity format. Introduce a stable team-slot ID for future custom-team and multi-game support.

### TEAM-002 - Generic team autocomplete is too broad for league-scoped commands
**Severity:** P1

The generic TEAM_OPTIONS branch can enumerate teams across the entire open-team registry. Several commands need stricter league-aware candidate sets.

**Required change**
Create command-specific team candidate policies:
- select-team: OPEN teams in selected/joinable league;
- add-member-to-league: OPEN teams in selected league;
- release-team: CLAIMED teams in selected/current league;
- report-result/create-game: CLAIMED teams in the same league;
- trade commands: owned/eligible teams in the same league;
- reward/postseason commands: active team/member entities in the configured season/league.

### TEAM-003 - Internal emoji names leak into user-facing team boards
**Severity:** P1

`teamUtils.getTeamEmoji()` falls back to textual tokens such as `:1804panthers:` when a custom emoji is missing. The live board shows an internal legacy emoji name before Carolina Panthers.

**Required change**
- Never render an internal emoji asset key as plain user-facing text.
- If a custom emoji cannot be found, return an empty string or an approved Unicode fallback.
- `audit-emojis` should report missing mappings to commissioners instead of leaking the key on public boards.
- Add a display-sanitization regression for all 32 NFL teams and every supported game pack.

### MEMBER-001 - Add-member dependent autocomplete must survive manual league entry
**Severity:** P0

The team autocomplete for `/add-member-to-league` directly consumes the raw `league` option as an ID. If the league field is manually typed as a name, team suggestions are empty even when the league exists.

**Required change**
Resolve the league field through the canonical league resolver before obtaining open teams. The execute path and the autocomplete path must use the exact same resolver.

### MEMBER-002 - Partial success can leave membership changed when team assignment fails
**Severity:** P1

`/add-member-to-league` grants league access before optional team assignment. If team assignment fails, the response states access was granted but leaves the member in a partially completed state.

**Required change**
Define and implement an explicit transaction policy:
- Option A: atomic add+team assignment, with access rollback if requested team assignment fails; or
- Option B: intentionally allow league membership without a team, but record `AWAITING_TEAM` state and send the correct member onboarding card.

Do not leave the state implicit. The implementation contract recommends Option B for commissioner flexibility, with durable onboarding state and a clear status.

### UX-001 - No dedicated active-league discovery command
**Severity:** P1

The screenshots show the user searching for `/activeleagues`, but no such command exists. Discord therefore suggests destructive or unrelated commands such as delete/reset/active-check-status.

**Required change**
Add a discoverable read-only command, preferably:
- `/leagues list`
- `/leagues status league:<optional>`
- `/leagues members league:<required>`
- `/leagues teams league:<required>`

For backward discoverability, optional alias `/active-leagues` may map to `/leagues list`.

The list view should show canonical league name, short ID, game, status, member count, claimed/open team count, provider mode, current week/season, and whether the league is joinable.

### UX-002 - Error messages collapse distinct causes into one misleading phrase
**Severity:** P1

"That league is no longer active" is displayed for any unresolved league value, even when the actual problem is that the user typed the visible name rather than the canonical ID.

**Required change**
Standardize league resolution errors:
- `LEAGUE_NOT_FOUND` -> "I couldn't match that league. Choose it from the list or run /leagues list."
- `LEAGUE_ARCHIVED` -> "That league is archived."
- `LEAGUE_ARCHIVING` -> "That league is being archived. Wait for cleanup to finish."
- `LEAGUE_AMBIGUOUS` -> "More than one league matches that name. Choose the exact league."
- `LEAGUE_WRONG_GUILD` -> internal/security-safe message.

### STATE-001 - Guild scoping is not consistently applied to league enumeration
**Severity:** P1 / future multi-guild blocker

Canonical records include `guildId`, but generic list functions and many callers do not filter by current guild. This is tolerable only while one configured guild is assumed.

**Required change**
All user-facing selectors, provider routes, member access, rewards, postseason, and diagnostics must take `guildId` explicitly or derive it from a trusted interaction/message context.

### STATE-002 - Encoded display values are being used as identity transport
**Severity:** P1

The code has multiple `split('::')` consumers and currently transports team plus league identity in a display-option string. This is fragile for custom names, future game packs, and migrations.

**Required change**
Introduce durable IDs:
- leagueId - canonical UUID/space ID;
- teamSlotId - durable league-local slot identity;
- membershipId - leagueId:userId;
- optional seasonId.

Autocomplete `value` should carry the stable ID wherever practical, and execution must re-resolve the current object from storage before mutation.

## Codebase-wide audit scope
The implementation pass must inspect, classify, and test:
- all 37 current autocomplete declarations;
- all 17 router `interaction.respond()` paths;
- all 32 current `listActiveLeagues()` consumers;
- all league-option consumers and the lone `league-id` consumer;
- all team identity paths using encoded `::` values;
- join, select-team, register-team, release-team, add-member, delete/reset, export receiver, provider/sync, active-check, schedule, trade, reward, and future postseason paths;
- all user-facing emoji/team rendering surfaces.

## Required service boundaries

### `autocompleteService`
Owns Discord autocomplete lifecycle, validation, limits, incident logging, and safe response.

### `leagueResolverService` or expanded `activeLeagueService`
Owns canonical ID/name resolution, guild scoping, status policy, and ambiguity handling.

### `teamCandidateService`
Returns command-specific team candidates based on league, availability, ownership, role, and season.

### `displayTokenService`
Ensures missing emoji/custom assets degrade to clean text or approved Unicode, never internal asset keys.

## Required observability
Every failed autocomplete must record:
- command name;
- focused option;
- normalized focused text length, not secrets;
- guild ID;
- latency;
- resolver stage;
- incident fingerprint;
- exception class/message after redaction.

Add a rolling diagnostic count to `/diagnose` or `/audit-wiring` for autocomplete failures and stale league-reference failures.

## Required regression suite
1. Autocomplete object with only `respond()` does not crash in `protectInteraction()`.
2. Every autocomplete declaration has a responder contract.
3. Every responder returns <=25 unique choices with legal names/values.
4. League autocomplete excludes ARCHIVING/ARCHIVED and wrong-guild records.
5. League resolver accepts exact canonical ID.
6. League resolver accepts exact visible name case-insensitively.
7. Resolver rejects ambiguous duplicate league names.
8. Add-member autocomplete resolves league name and then returns only that league's open teams.
9. Add-member execution with visible league name reaches the same canonical league as autocomplete.
10. Select-team with two leagues containing Ravens requires/retains exact league scope.
11. Manually typed team cannot silently jump to another league.
12. League-channel select-team can infer its own league if policy allows it.
13. Single-league global select-team can infer the only joinable league.
14. Archived league cannot be used for join/add/export/team claim.
15. Broken/missing custom team emoji never renders `:internalname:`.
16. All 32 NFL open-team rows render cleanly when no custom emojis are installed.
17. `/leagues list` shows operational truth and does not expose stale fallback records as active.
18. Reboot/hydration preserves the same canonical league IDs and autocomplete results.
19. `/initialize-server` leaves no stale league/team autocomplete candidates.
20. Runtime incidents capture intentionally injected autocomplete failure without double responding.

## Release gate
This amendment is release-blocking for public beta. The build is not considered interaction-stable until:
- live Discord autocomplete succeeds for league, team, community, emoji, and attribute options;
- the full autocomplete registry test passes;
- league state selectors are status-aware and guild-scoped;
- member/commissioner manual text fallback cannot produce misleading inactive-league errors;
- multi-league duplicate-team tests pass;
- no user-facing board leaks internal emoji identifiers;
- all existing regression suites remain green.

## Live staging acceptance sequence
1. Build two Madden leagues with overlapping NFL team names.
2. Run `/leagues list` and confirm both canonical records are shown.
3. Open `/join-league league:` and verify suggestions load immediately.
4. Open `/add-member-to-league league:` and verify suggestions load immediately.
5. Select one league, then focus team and verify only that league's open teams appear.
6. Type the exact visible league name manually and verify it resolves to the same canonical record.
7. Run `/select-team` inside league A and confirm league A is retained in the confirmation.
8. Run `/select-team` globally with multiple leagues and confirm exact league selection is required.
9. Claim Ravens in league A and verify Ravens in league B remains independently available.
10. Add a member to league A after the claim and verify no false "no longer active" response.
11. Disable/remove the Panthers custom emoji and verify the board displays clean team text with no `1804panthers` token.
12. Archive league A and confirm it disappears from join/add/export autocomplete but remains visible in commissioner history/diagnostics.
13. Restart the bot and repeat steps 2-6.
14. Run `/initialize-server` and confirm all league/team autocomplete results are empty until a new league is built.

---

# Architecture Evolution and Progression Contract Amendment

## Commissioner-configurable attribute point caps

The progression engine MUST support optional commissioner-configured attribute point caps. An attribute point is one rating point applied to one editable player attribute. Caps are policy, not hard-coded behavior.

Required policy dimensions:
- enabled/disabled per league and season;
- independent initial-team attribute budget and member-earned reward budget;
- optional member-season, team-season, player-season, per-claim, and per-attribute caps;
- skill-only / skill+mental / all-editable / allowlist / denylist physical-attribute modes;
- explicit overflow behavior (reject, bank-but-lock, convert, expire), defaulting to reject with a clear remaining-points message;
- versioned/effective-dated changes with audited retroactive override confirmation.

Initial team grants belong to the team/season and MUST NOT regenerate when ownership changes. Unspent member-earned rewards belong to that member's tenure and are forfeited on configured departure events. Replacement owners can earn their own future rewards but do not receive a fresh initial team package.

## Codebase audit findings that are now part of the contract

Static scan of the current Multimodal build identified the following structural pressure points:
- `src/routing/interactionRouter.js` is ~5,147 LOC, ~129 switch cases, and statically fans out to ~101 internal modules.
- `src/services` contains ~133 service files / ~24,286 LOC.
- `src/commands.js` is ~1,080 LOC with ~430 builder `.setName()` calls.
- The source contains 73 `loadJson`, 55 `saveJson`, 52 `saveJsonDebounced` calls plus Prisma and `criticalStore` persistence paths.
- Roughly 127 JSON filename literals are referenced in `src`.
- Roughly 175 direct `process.env` reads remain in `src`.
- Roughly 734 direct Discord reply/edit/followUp/send call sites remain in `src`.
- Roughly 487 `catch(() => null)` patterns and ~140 empty catch blocks exist in `src`.
- Static dependency analysis found at least four CommonJS cycles.
- The current TypeScript config has `allowJs:true`, `checkJs:false`, `strict:false`; therefore `npm run tsc` is not a meaningful business-shape type gate for the JavaScript tree.
- Only a small portion of the test suite exercises the real interaction router/Discord acknowledgement lifecycle directly.

## Required architectural direction

NOFUNBOT should remain one deployable modular monolith plus worker. Do NOT split into network microservices yet. Introduce explicit bounded domains, a thin Discord adapter, an application/use-case layer, repositories, and domain-owned invariants.

New core business flows MUST use an explicit request context containing canonical IDs such as `guildId`, `leagueId`, `seasonId`, `teamId`, `membershipId`, actor identity, channel/interaction ID, and correlation ID. AsyncLocalStorage/scoped Proxy state may remain only as a temporary compatibility bridge.

PostgreSQL becomes the authority for league, season, membership, team assignment, progression, reward, postseason, provider connection, and audit records. JSON remains migration/export/debug compatibility, not primary authority. No new JSON authority may be introduced for progression/postseason/membership/league business data.

## Progression engine replacement requirement

Do NOT extend `pendingAttrBoosts` into the new progression engine. Replace it with canonical records for:
- `ProgressionPolicyVersion`
- `TeamInitialGrant`
- `MemberRewardGrant`
- `ProgressionWallet`
- `ProgressionClaim`
- `PlayerMutation`
- `EntitlementConsumption`
- `MembershipTenure`
- `Season`
- `TierAssignment`
- `PostseasonBracket/Match`

Current `claim-attr-boost` is not a safe foundation because the request stores `requesterId/team/source/attribute1/attribute2` while the approval path reads `userId/teamName/sourceLabel/attr1/attr2`. The new claim record MUST have one canonical shape, one constructor/validator, one repository, idempotency, and transactional consumption/mutation semantics.

Members MUST NOT select a free-form reward source. They consume an actual unspent entitlement or wallet balance. Team/player ownership and roster identity are resolved canonically. All enabled caps and policy restrictions are evaluated before consumption. Approval and entitlement consumption must commit atomically or neither commits.

## Interaction/router restructuring

The interaction router must become a thin dispatcher. New/rewritten commands should move into domain command handlers and autocomplete resolvers. A single `InteractionResponder` owns Discord acknowledgement behavior (`respond`, `reply`, `deferReply`, `editReply`, `followUp`, component update) so autocomplete and command response lifecycles cannot diverge.

Command registration should be generated from the same command specification that declares handler, permission class, context requirements, feature flag, validation, and autocomplete resolver.

## Persistence consolidation

Consolidate current duplicate/transitional authorities:
- `User` + `MemberProfile` -> one canonical guild member profile model;
- `AuditEvent` + `AuditLog` -> one structured audit/event model;
- Prisma `League` + `activeLeagues.json` -> Prisma/repository league authority;
- `Team`/`TeamMember` + players/openTeamRegistry/teamRegistry projections -> canonical team/membership/assignment records;
- critical business records in `bot_kv` -> normalized tables over time;
- add a real League FK to ProviderConnection after league ID migration completes.

## Error, type, and test contract

Critical writes may not be hidden by null/empty catches. Application use cases return structured results/errors; persistence failures fail the operation; Discord projection failures create repair work after a committed domain change.

Gradually make type checking real. Enable `checkJs` or TypeScript first for new domain/application modules, then migrate high-value contexts and progression records. The requesterId/userId mismatch above is an explicit acceptance example that the new type contract must catch.

Add test layers for domain policy, repository contracts, Discord interaction lifecycle/autocomplete, state machines, concurrency/double-spend, legacy migration parity, and live staging. Add coverage reporting.

## Required migration order

0. Fix P0 autocomplete/interaction lifecycle and canonical league resolver defects.
1. Add RequestContext, InteractionResponder, structured domain results/errors, central RuntimeConfig.
2. Move canonical league/season/membership/team authority to PostgreSQL repositories.
3. Decompose high-risk commands/autocomplete from interactionRouter.
4. Implement progression policy, tiers, initial grants, member wallets, attribute caps, dev/AR/attribute claims and mutation ledger.
5. Implement explicit season/postseason lifecycle and bracket engine.
6. Render boards/guides from canonical policy/event data and add Discord repair jobs.
7. Retire pendingAttrBoosts, duplicated reward constants, ambient league inference, old JSON authorities and obsolete compatibility/alias scaffolding.

## Release gate before tier/progression/postseason rollout

The new engine does not ship until canonical league resolution, persistence/restart behavior, progression grant idempotency, ownership-transfer semantics, attribute caps, forfeiture, mutation provenance, policy-rendered boards, season lifecycle, durable incident logging, real type checks, interaction contract tests, and two-league live staging all pass.

# Specificity and Dynamicization Amendment

## 1. Static audit evidence

The current Multimodal_Fix tree shows several classes of architectural ambiguity that must be removed before progression/postseason expands further:

- `src/routing/interactionRouter.js` is ~5,148 LOC with 129 command cases and ~162 `require()` calls.
- `src/services/leagueSetupService.js` is ~1,360 LOC and mixes league templates, rule prose, schedule math, postseason assumptions, channel topology, build orchestration, and wizard UI.
- `src/services/flowDefinitions.js` is ~1,104 LOC with ~99 `require()` calls.
- The tree contains 197 JavaScript files under `src`, including 133 service files.
- 78 source files still contain the generic navigation-header text `PURPOSE: Supports this part of the system...` and 79 contain the generic related-flow placeholder.
- Static identity scan found 22 literal `default` fallbacks, 11 `current` fallbacks, and 12 `global` fallbacks in `src`.
- Error scan found 487 `.catch(()=>null)` paths and 181 empty catches.

These are not all bugs by themselves. They identify places where ownership and semantics are too weak for a multi-league, multi-season, policy-driven bot.

## 2. No-placeholder identity rule

New canonical business records MUST NOT be written with synthetic identity values such as:

- `leagueId = "default"`
- `seasonId = "current"`
- `guildId = "global"`
- synthetic league id `"current"`

Legacy readers may recognize these values only inside an explicit migration/compatibility adapter. New writes must resolve a real canonical ID or fail closed.

Affected current areas include:

- `src/league/canonicalModel.js`
- `src/league/runtimeService.js`
- `src/league/gameSessionService.js`
- `src/league/gameResultService.js`
- `src/league/advanceEngine.js`
- `src/services/streamCreditService.js`
- `src/services/gameChannelService.js`
- provider/background lock keys

## 3. Active league semantics

`activeLeagueService.listActiveLeagues()` is too broad. It currently maps registry entries without encoding what "active" means.

Replace broad selectors with lifecycle-specific queries:

- `listJoinableLeagues()`
- `listOperationalLeagues()`
- `listProgressionEligibleLeagues()`
- `listProviderTargets()`
- `listResettableLeagues()`
- `listArchivableLeagues()`

`getCurrentLeagueFallback()` is migration-only and may not become normal runtime behavior.

`setDataSourceMode()` must reject unknown modes instead of silently coercing them to `custom_bot_managed`.

## 4. Command surface must become policy-aware

The following static command assumptions must move to canonical policy/catalog services:

- `/setup-league` must not claim the command runs only once on a fresh server.
- `/join-league` may omit league only when exactly one joinable league is resolvable.
- `/select-team` must carry league identity explicitly or through an opaque canonical TeamSlot token.
- `/rewards-board` resolves exact league + season.
- `/start-season` must not hard-code a 15-member rule.
- `/superbowl-champion` must not hard-code `1 AR + 1 XF`.
- `/yearly-award` must come from an award catalog rather than a fixed list plus `Other Award`.
- `/claim-attr-boost source` must consume a real entitlement or wallet balance; members cannot self-declare reward provenance.
- `/set-timezone` must use an IANA timezone resolver rather than four fixed US zones.
- `/league-export current` must resolve exact league/season before "current week" is meaningful.

## 5. Progression/reward policy must be dynamic

Move the following out of handlers, boards, static rule prose, and channel topics:

- 8/16 stream milestones
- every-stream `+2` behavior
- POTW boost amount
- champion AR/XF rewards
- skill/physical restrictions
- reward expiry/forfeiture rules
- per-player / per-attribute / per-claim caps
- commissioner optional total attribute-point cap
- warning/removal thresholds when they are league policy
- scheduling/advance windows

All command UI, eligibility checks, claim validation, #rules, #rewards, and audit messages must render from the SAME immutable effective policy version.

## 6. Attribute catalog must be game-specific

Current attribute definitions are duplicated and inconsistent across `commands.js` and `src/config/teams.js`.

Replace free-form/broad categories such as `physical`, `mental`, `character`, `defense`, and `power` with a canonical catalog:

```text
GameAttributeCatalogEntry {
  gameId,
  gameVersion,
  key,
  providerField,
  displayName,
  abbreviation,
  group: SKILL | PHYSICAL | MENTAL | SPECIAL,
  positionsAllowed[],
  minValue,
  maxValue,
  defaultPointCost,
  active
}
```

Commissioner policy can then allow:

- skill only
- skill + mental
- all editable attributes
- custom allowlist/denylist
- weighted attribute cost
- optional total attribute cap
- optional per-player cap
- optional per-attribute cap
- optional per-claim cap

## 7. League setup must be decomposed

`leagueSetupService.js` currently owns too many unrelated concerns. Extract:

- `LeagueTemplateRegistry`
- `GameCatalog`
- `SeasonStartPolicy`
- `SchedulePolicy`
- `PostseasonPolicy`
- `LeagueBuilder`
- `LeagueRulesPresenter`
- `ChannelGuideRenderer`

Hard-coded values such as `MIN_MEMBERS_TO_START = 15`, football half-season = 10, partial = 75%, and playoff-team heuristics become preset values or league policy, not universal rules.

## 8. Team/division config becomes a versioned game catalog

`src/config/teams.js` is seed data, not live truth.

- stock teams/divisions get a game/version catalog identity
- provider-imported IDs become authoritative live identity
- custom/relocated teams get explicit records
- emoji/slang maps are presentation/search aliases only
- internal emoji upload names may never leak to user-facing copy

## 9. Timezone becomes a resolver, not a four-choice constant

Persist the IANA timezone ID. Render current abbreviation/offset for the relevant date.

- command autocomplete/search supports global zones
- common aliases resolve to an IANA ID
- onboarding copy is region-neutral
- nickname formatting is presentation policy

## 10. Template/channel/guide manifests

Structure/copy is duplicated across channel guide, template registry, community pack, custom mix, league setup, manual, wizard renderer, channel config, and server template logic.

Create one versioned manifest model:

```text
TemplateManifest {
  id,
  version,
  purpose,
  games[],
  categories[],
  channels[],
  roles[],
  permissions[],
  guideSections[],
  enabledCommands[],
  components[],
  defaultPolicies{},
  migrationRules{}
}
```

Mutable league-policy text must be rendered from policy, never copied into static channel topic strings.

## 11. Concrete broad/vague logic defect

`architectureSemanticsService.classifySpace()` currently contains:

```js
selectorVisible: !key.includes('qa') || true
```

This expression is always true. Replace string-heuristic behavior with explicit manifest capabilities and add static/lint coverage for always-true/always-false boolean expressions.

## 12. Broad service naming

The following names are broader than their real responsibility and should be renamed/split as touched:

- `stabilityCoreMicroservice` -> startup/bootstrap coordinator responsibilities
- `serverOperatingSystemMicroservice` -> installation/setup startup coordinator
- `automationAccessMicroservice` -> scheduler/provider/access startup tasks
- `processBuilderService` / `processManagementService` -> typed workflow registry/runner if retained
- `stateService` -> compatibility facade during migration
- `architectureSemanticsService` -> template capability resolver backed by manifests

NOFUNBOT should remain a modular monolith for now. Do not create network microservices merely to match these names.

## 13. Typed failures instead of vague unknown/null

Core services use a typed result vocabulary:

```text
NOT_FOUND
AMBIGUOUS
NOT_CONFIGURED
UNAUTHORIZED
INVALID_STATE
STALE
PROVIDER_UNAVAILABLE
CONFLICT
INTERNAL
```

Critical state changes do not end in `catch(()=>null)`.
Best-effort UI cleanup may fail softly, but must be explicitly labeled best-effort.

## 14. Configuration hierarchy

Resolve mutable values through the correct scope:

1. system/deployment config
2. game/plugin catalog
3. league template preset
4. immutable league policy version
5. season snapshot
6. team/membership tenure state
7. member wallet/entitlements
8. user profile

Identity fields never use this fallback hierarchy.

## 15. Static-analysis rules to prevent new vague code

CI should reject new core code that introduces:

- generic placeholder module headers
- new `default/current/global` durable-ID fallbacks
- hard-coded reward quantities in handlers/presenters
- duplicate attribute category arrays
- mutable policy values in slash-command descriptions
- empty catches on authoritative mutation paths
- always-true/always-false expressions
- `process.env` reads outside configuration/infrastructure layers
- new JSON files as primary authority for core domains

## 16. Acceptance criteria

Before postseason/progression is considered architecture-complete:

- all league/season selectors use canonical resolvers
- lifecycle-specific league queries replace generic "active" semantics
- reward provenance comes from entitlements/wallets, not user-entered source labels
- commissioner attribute caps are versioned policy and transactionally enforced
- attribute choices come from a game/version catalog
- rules/boards/eligibility render from the same policy version
- timezone onboarding supports global IANA zones
- new core modules have precise module contracts
- authoritative failures are typed and observable
- each compatibility fallback has an owner, telemetry counter, migration test, and removal condition

---

# Code Convergence, Dead-Code, Cycle, and Decomposition Amendment

## Audit snapshot

Current Multimodal_Fix tree:
- 197 JavaScript files under `src`, about 39.4K LOC.
- `src/routing/interactionRouter.js`: about 5,147 LOC, 101 internal dependencies, 129 command cases.
- `_handleCommand`: about 3,021 lines / ~750 branch points.
- `_handleButton`: about 924 lines / ~261 branch points.
- `flowDefinitions.registerAll`: about 1,078 lines.
- `leagueSetupService.js`: about 1,359 lines.
- 44 service/domain files directly use `loadJson`/`saveJson`; at least 16 implement their own `_load/_save`, registry, or config wrappers.
- Four dependency cycles exist, including a 13-module league/team/state cycle and a 7-module provider cycle.
- Command contract currently passes: 116 command definitions, 129 router cases, 13 explicitly classified legacy/internal cases.

## Material duplicate code that must converge

1. Exact `_timingSafeEqual()` duplication in Madden Companion export and NeonSportz webhook routes. Move to one security utility.
2. Stat-leader embed duplicated between `statLeaderService` and `rewardBoardService`. One presenter owns rendering.
3. Media-context analysis/fallback block repeated in commissioner/member/IT handlers. Use one conversation media context builder.
4. Category normalization/grouping duplicated in base-init dedup and diagnostics. Use one topology index.
5. Interaction reply/defer/update/settlement behavior is parallel across `interactionRouterService`, `responseLifecycleService`, `responseGuardService`, and router-local helpers. Replace with one `InteractionExecutionContext`.
6. Reward/rules facts (8/16 streams, +2 boosts, physical restrictions, postseason rewards, scheduling windows) are duplicated across rules, setup, boards, commands, services, and router copy. Effective policy is the single authority.
7. Template/channel/guide definitions are duplicated across template registry, server template logic, league setup, channel config, community packs, guides, manual, and base init. Use versioned `TemplateManifest` data.
8. Process/workflow/stage semantics are spread across process builder/management, workflow engine/registry, flow definitions, and stage registry. Use one `WorkflowDefinition` schema and one engine.

## Confirmed stranded helpers

The following private helpers have no current runtime call site and must be deleted, deliberately wired, or explicitly registered as compatibility callbacks:
- `commissionerHandler.js`: `isAllowedAttachmentUrl`, `_requireChannelResolver`
- `interactionRouter.js`: `_guardBotKilledCommand`, `_archiveSetupWizardChannel`, `_buildTimezoneModal`, `_hasAnyCommissionerTimezone`, `_sendSetupWizardNudge`, `_deferSetupWizardInteraction`, `_finishSetupWizardInteraction`, `_safeWizardUpdate`, `_starterNoteForMode`, `_updateStarterMessageFromButton`, `_ephemeralWizardModeMsg`, `_starterFollowupNeeded`
- `wizardRendererService.js`: `_buildCustomMixGamingRow`, `_buildCustomMixSportsRow`, `_buildCustomMixCommunityRow`, `_buildCustomMixMediaRow`
- `patchNotesService.js`: `_patchDocFiles`
- `baseInitService.js`: `_guaranteeBotAccess` (comment already states its call was removed)

Do not misclassify explicit entrypoints as dead code. `src/queue/worker.js` is launched by npm/Railway and is therefore an entrypoint even though it is not required by `index.js`.

## Dependency cycles that must be broken

### League/team/state cycle
A 13-module SCC currently includes `state`, `scopedState`, `activeLeagueService`, `leagueSetupService`, `managedSpaceService`, `openTeamsService`, `teamAssignmentService`, `teamRegistryService`, `leagueVisibilityService`, `nicknamePolicyService`, `accessPolicyService`, and team/helper modules.

Required boundary:
`Discord adapters -> application use cases -> domain services/policies -> repositories`.
No domain service may import the setup orchestrator or global state to resolve identity.

### Provider cycle
`gameProvider` imports concrete providers while concrete providers import `gameProvider` abstractions. Invert registration: pure provider interface/types import no implementation; the composition root registers concrete adapters into `ProviderRegistry`.

### Base-init / patch-notes cycle
Patch notes must depend on channel provisioning/manifest services, not `baseInitService`. Base init may call the publisher only after structure build completion.

### Commissioner-handler / interaction-router cycle
Message and slash adapters must be siblings. Shared behavior moves to application use cases; adapters never import one another.

## Mandatory decomposition targets

- Split `_handleCommand` into domain command controllers/application handlers. Router becomes transport-only and should trend below ~800 LOC.
- Split `_handleButton` into a component-controller registry.
- Replace `flowDefinitions.registerAll` with domain workflow manifests loaded by bootstrap.
- Split `leagueSetupService` into template resolver, builder, schedule policy, postseason policy, presenter, and lifecycle orchestration.
- Converge member/commissioner/IT message pipelines around shared media/context/safety/lifecycle middleware with persona capabilities injected.
- Split hub screenshot handling into parse -> classify -> validate DTO -> import use-case.
- Split `advanceEngine._step` into explicit state handlers behind a transition table.
- Split game-channel creation into identity resolution, authorization, Discord resource creation, manifest persistence, and compensation.

## Repository/storage convergence

New core domain code must not call `jsonStore` directly. Use explicit repositories for League, Season, Membership, TeamSlot, Progression, ProviderConnection, Schedule, and Workflow state. Repositories decide transaction/durability/scoping semantics. Critical writes are transactional; presentation caches may remain best-effort.

## Interaction lifecycle convergence

Only `InteractionExecutionContext` may directly call Discord acknowledgement/settlement methods (`reply`, `deferReply`, `deferUpdate`, `editReply`, `update`, `followUp`). Autocomplete has a strict isolated path using `respond()` only. Domain handlers return typed results and never settle Discord interactions themselves.

## Membership convergence

`openTeams` becomes a read model over TeamSlot + TeamAssignment, not another ownership registry. Team identity and team ownership are separate. Membership, team assignment, timezone/profile, nickname, access, leave/kick/ban and replacement-owner flows move behind `MembershipApplicationService` with canonical IDs and emitted lifecycle events.

## Progression/reward convergence

Do not add tiers/dev traits/ARs/attributes/postseason rewards as more router cases or parallel arrays. Converge to:
- `RewardPolicyVersion`
- `AttributePolicyVersion` (including commissioner-configurable wallet/team/player/claim/per-attribute caps)
- `ProgressionWallet`
- `ProgressionClaim`
- `PlayerMutation`
- `AwardCatalog`
- `PostseasonRewardPolicy`

Member-entered reward provenance is forbidden. Rewards are server-issued entitlements.

## Compatibility retirement contract

Every compatibility path must have: `compatId`, owner, canonical replacement, telemetry counter, removal condition, deadline release, and regression test. New callers may not target deprecated APIs. Existing examples include command aliases, game-channel compatibility, space migration, legacy provider fallbacks, and legacy naming wrappers.

## CI/static-analysis requirements

Add release-gating checks for:
- private zero-call functions unless explicitly annotated as entrypoint/registry callback;
- new dependency cycles and shrinkage of existing SCCs;
- material cross-file duplicate blocks;
- duplicate progression/reward literals outside policy seed/migration files;
- interaction acknowledgement methods used outside the execution-context adapter;
- new direct `jsonStore` calls from core domain modules;
- compatibility APIs without ledger metadata/telemetry;
- generic placeholder module headers in new/modified core files.

## Exit criteria

1. No handler imports a router and no router imports a message handler.
2. Provider interface/registry imports no concrete provider implementation.
3. The 13-module league/team/state SCC is eliminated.
4. `interactionRouter` no longer owns business mutations or multi-thousand-line handlers.
5. Critical domain state goes through repositories.
6. One canonical implementation exists for secure comparison, stat rendering, topology indexing, and media-context acquisition.
7. Workflow/process/stage definitions use one schema and engine.
8. Setup/template/wizard/guide behavior is manifest-driven.
9. Progression uses entitlements/wallets/claims and commissioner policy caps.
10. Compatibility paths have measurable removal plans.
11. Full regression + command contract + cycle/dead-code/duplicate scans pass before deployment.


# CIA Triad + Button-First UI Hardening Amendment (v5)

## Release-blocking findings
- **P0 Integrity:** `cleanSlateResetService` calls `memberLedgerService.resetAll()`, but `resetAll` is not exported. A true clean-slate can silently leave durable member ledger state behind. Repair via a canonical reset application service and restart/hydration tests.
- **P0 Integrity/UI:** Mutation authority must not depend on autocomplete or a raw target ID inside a component `customId`. Button sessions bind guild, actor, flow, canonical IDs, version and expiry server-side.
- **P1 Integrity:** `flowDefinitions` advertises automatic/executable workflows that do not own their claimed runtime triggers; `member-onboarding` references missing `ledger.getMemberHistory()`. Wire as canonical flows or remove them.
- **P1 Confidentiality:** `logger.js` and `securityMiddlewareService.auditLog()` need the same recursive redaction contract used by runtime incident capture.
- **P1 Availability:** multimodal ffmpeg/AI work needs a semaphore, per-guild/user limits, queue timeout and overload fallback. Recurring jobs need one scheduler registry/owner.

## Current codebase indicators
- 24 production `new StringSelectMenuBuilder()` instances across 8 files.
- 37 `.setAutocomplete(true)` declarations in `src/commands.js`.
- 35 `.addChoices(...)` declarations in `src/commands.js`.
- 42 current `ButtonBuilder` instances across 8 files, but no single panel/session design system.
- Static scan matched 549 catch-to-null suppressions across 62 files and at least 44 exact empty catch blocks.
- 232 direct `process.env` references across 61 files and 205 direct `console.*` references across 52 files.

## Button-first rule
The target is **zero bot-rendered StringSelectMenuBuilder menus** after migration. Discord owns the slash command form, so native `UserOption`/`AttachmentOption` may remain where buttons cannot practically represent the search space. Product decisions should become post-command button panels. League/team/community/player mutation authority must not depend on autocomplete.

### Standard patterns
- 2-5 choices: one button row.
- 6-20 choices: paginated button grid.
- 32 NFL teams: conference -> division -> team buttons.
- Large/custom catalogs: search modal -> canonical result buttons.
- Multi-select: toggle buttons + Done.
- Numeric policy: preset buttons + Custom modal.
- Destructive action: impact summary -> Danger confirm + Cancel.

### Component session contract
```text
ComponentSession {
  sessionId, guildId, actorId, flow,
  leagueId?, teamSlotId?, membershipId?, policyVersionId?,
  allowedActions[], stateVersion, page, selections[],
  createdAt, expiresAt
}
customId = ui:<sessionId>:<action>
```
Every click re-checks session, guild, actor, permissions and current domain version. Double-click/retry is idempotent. Stale sessions never mutate.

## Uniform UI contract
- Primary = forward/navigation/main non-destructive choice.
- Secondary = back/cancel/unselected toggle.
- Success = validated final positive commit.
- Danger = destructive/irreversible only.
- Text labels are mandatory; emoji/color are supplementary.
- Maximum 5 buttons per row.
- Multi-step panels expose Back/Cancel and a deterministic expiry message.
- Admin/setup panels are ephemeral by default.
- Application services never construct Discord components; adapters/UI renderers do.

## Mandatory CIA gates
- Secret canary redaction across logger, audit, incident, webhook test sink and user-visible errors.
- Initialize-server reset + restart + hydration must not resurrect erased state.
- Workflow reachability test for every registry entry marked executable.
- CI rejection of new empty catches/catch-to-null outside an approved `bestEffort()` wrapper.
- CI rejection of production `StringSelectMenuBuilder` after migration.
- Component cross-user/cross-guild/stale-session/double-click tests.
- Media concurrency/backpressure tests.
- Scheduler single-owner/restart tests.
- Typed public error tests; no raw internal `err.message` for normal members.

## Delete / repair register
- Repair `memberLedgerService.resetAll` reset contract (P0).
- Repair or delete unwired/broken `flowDefinitions` workflows.
- Delete unused `_patchDocFiles`, `_db`, and obsolete setup-wizard helpers after regression coverage.
- Delete or converge unused `responseLifecycleService.executeInteractionLifecycle`.
- Delete `_guaranteeBotAccess` after initialization/access regression tests.
- Fix the always-true `selectorVisible: !key.includes('qa') || true` policy condition.
- Update misleading architecture comments that no longer match runtime ownership.


---

# V6 Amendment - Flow, Trigger, Time-Flow, Workflow, and R-Mode Engagement Audit

## Executive verdict

- 25 workflow definitions are registered (3 built-ins + 22 flowDefinitions). Only `post-build` and `post-trash` have direct production invocations; `/workflow run` is manual.
- The 22 flowDefinitions workflows are not automatically invoked from their declared triggers. Most duplicate live direct handlers.
- `post-league-reset` is manual-only and its normal `/workflow run` context omits the services its useful steps require, so it can become a successful no-op.
- `workflowEngine.onEvent()` has no runtime listeners. The one `emitJobEvent()` currently has no consumer. `backgroundJobService` does not emit the lifecycle events its workflow comments describe.
- Process Builder stores triggers but has no trigger dispatcher; its presets overlap the workflow engine.
- League advance/provider recovery use the right durability pattern. Hub release/POTW and fixed-PST scheduling do not.
- R member AI supports hard-edged persona banter after invocation, but invocation is explicit-mention-only. Open House is not wired.

## Mandatory architecture changes

1. One Trigger Dispatcher for Discord, HTTP, scheduler, background-job, and startup envelopes.
2. One canonical Workflow Engine with required context schemas, fail-fast mutation defaults, idempotency, compensation/recovery, and durable run observability.
3. Process Builder becomes an authoring surface into that engine, not a parallel executor.
4. Workflow registry reports `wired/manual-only/shadow-duplicate/dormant/broken`, actual entrypoints, durability, idempotency, and observed runs.
5. One Scheduler Registry; business intent is persisted before timers are armed.
6. Replace fixed PST offsets with IANA timezone scheduling. Persist POTW due state and recover it on boot.
7. Preserve advanceEngine/provider receipt recovery as the reference pattern.
8. Introduce `SpeechPolicy` + `TrashTalkEngagementPolicy`. R mode may enable `open_house` in designated banter channels, with cooldowns/dedupe/burst caps.
9. Ordinary competitive banter uses the persona route instead of canned R-only phrase handlers. Safety refusals remain deterministic.
10. Protected-class hate, doxxing, credible threats, and targeted harassment remain blocked in all ratings; fix the current R bypass in `contentScanService`.

## Open House modes

- `mention_only` - explicit mention only.
- `reply_or_mention` - bot reply continuation or mention.
- `open_house` - ambient participation in commissioner-designated R banter lanes with trigger score and cooldowns.
- `silent_observer` - context only, no ambient speech.

## Priority defects

- `member-onboarding` calls nonexistent `memberLedgerService.getMemberHistory()`.
- `post-league-reset` can be a no-op with standard manual context.
- Workflow conditions swallow exceptions as skips; mutating workflows continue after errors unless callers set `stopOnError`.
- `member-boot` does not actually kick/ban.
- `content-moderation` treats every blocked event as escalation without a repeat threshold.
- `schedule-advance` is a dangerous shadow of provider-verified `advanceEngine`.
- Process Builder triggers are decorative.
- `emitJobEvent()` has no live listener path.
- Hub release uses fixed UTC-8 instead of Pacific civil time.
- POTW six-minute follow-up is memory-only and can be lost on restart.
- Active-check interval duplicates the configured constant as a literal.
- R-mode AI requires explicit mention and includes canned pre-AI clapbacks; Open House is absent.

## Acceptance gates

- Every WIRED workflow has a real trigger integration test.
- Every business deadline survives restart.
- Every business scheduler is visible in Scheduler Registry diagnostics.
- Mutating workflows fail fast unless a step is explicitly optional.
- R Open House never bot-loops, double-replies, or speaks in excluded staff/read-only lanes.
- R Open House uses configured persona/tone and supports memes/GIF context.
- Safety invariants remain identical across member, commissioner, media, persistence, and learning paths.

---

# Amendment v7 — Natural AI Action Pipeline, Guard Ownership, and Runtime Convergence

## 166. Scope
This amendment adopts the concrete engineering findings from the pasted review while intentionally excluding unverifiable authorship claims. The contract cares about testable architecture: broad regex intent parsing, duplicate state transitions, overlapping guard layers, swallowed failures, multiple execution paths, duplicated timeout ownership, and architectural comments whose guarantees are stronger than the implementation.

## 167. Natural conversation remains a first-class interface
NOFUNBOT must remain easy to prompt through ordinary conversation, slang, shorthand, pronouns, replies, R-mode banter, and Open House context. The internal refactor must not force users into rigid command phrasing.

Target pipeline:

```text
Discord conversation / reply / Open House / slash / button
        -> conversation + multimodal context
        -> intent understanding
             - deterministic high-confidence hints
             - AI semantic interpretation
             - concise clarification when ambiguous
        -> canonical ActionIntent
        -> application use case
             -> authorization
             -> canonical league/entity resolution
             -> validation
             -> confirmation policy
             -> transaction/repository mutation
             -> audit + projection + response
```

Regexes may provide high-confidence recognition or candidate extraction. They must not directly own authoritative mutation.

## 168. NaturalActionPlanner is an intent adapter, not a second command system
Slash commands, buttons, regex/NLP, AI-generated actions, and Open House conversation must converge on the same application use cases for the same business operation.

No planner or conversational handler may call a mutation service in a way that bypasses the canonical authorization, league resolution, confirmation, transaction, and audit contract.

## 169. Action-catalog guarantees must be scoped and testable
Comments such as `single source of truth`, `all actions go through`, `only owner`, or `cannot drift` are architecture assertions. If they are true only for AI-generated catalog actions, say that explicitly.

Any exclusive-ownership claim must have an architecture test proving that no competing production mutation path exists.

## 170. Duplicate patching and redundant branches are blockers in touched code
Clean up and prevent:
- identical ternary / if-else branches;
- always-true or always-false conditions;
- repeated state patches representing one logical transition;
- duplicated fallback implementations;
- duplicated authorization or normalization logic;
- unreachable compatibility branches without a registered consumer.

A logical state transition should be one atomic application operation, not several adjacent patch calls.

## 171. Canonical guard ownership
| Responsibility | Canonical owner |
|---|---|
| Discord acknowledgement / reply state | `InteractionExecutionContext` |
| Intent parsing | slash/button/NLP/AI adapters |
| Input schema | command/action specification |
| Authorization | authorization/access policy |
| League/entity resolution | canonical resolver |
| Business validation | application/domain use case |
| Confirmation | `ConfirmationPolicy` |
| Mutation | application use case + repository |
| Persistence | typed repository |
| Discord rendering | presentation adapter |
| Audit/correlation | audit/event service |
| Language safety | speech/content safety policy |

Prechecks are allowed, but no layer may silently create a second source of truth for the same rule.

## 172. One AI timeout/cancellation/retry owner
A `Promise.race()` timeout does not by itself cancel the losing async request. Because the Anthropic SDK may also have its own timeout/retry behavior, NOFUNBOT needs one application-level policy owner for timeout, cancellation, retries, request budget, attempt IDs, and final outcome.

Target:

```text
AIRequestPolicy
  timeoutMs
  maxAttempts
  backoffPolicy
  cancellationOwner
  model
  maxTokens
  requestBudget
  correlationId

one request attempt
  -> one cancellation primitive
  -> one timeout owner
  -> one retry owner
  -> one attempt record
  -> one terminal outcome
```

Timed-out attempts must not be able to later produce a second response or mutation after a retry already succeeded.

## 173. Error suppression is semantic
- authoritative mutations: typed failure must propagate;
- durable writes: failure must propagate or compensate;
- Discord projection after commit: record repair/degraded projection state;
- optional UX: best-effort is allowed with telemetry;
- telemetry shipping: may degrade safely;
- read-only enrichment: may fall back only if the caller knows enrichment failed.

High-integrity league, membership, provider, progression, reward, postseason, and reset operations may not disappear into generic empty catches or `catch(() => null)`.

## 174. Static maintainability gate
Add a static/reporting gate for:
- identical branches;
- always-true/false expressions;
- duplicate logical state patches;
- direct domain mutation from intent/parser layers;
- duplicate normalization and authorization logic;
- unused private helpers / exported functions without a registered entrypoint;
- exclusive architecture claims without architecture tests;
- new swallowed errors in authoritative paths;
- new business timers outside `SchedulerRegistry`.

This is a maintainability gate, not an AI-authorship detector.

## 175. Natural-language parity requirement
Phrases such as the following must remain supported through semantic intent resolution:

```text
put Paul on the Ravens
Paul is taking Baltimore
give him Baltimore
nah switch him to the Jets instead
make this league advance every 48 hours
turn the trash talk all the way up in game-day
```

High confidence should feel immediate. Low confidence or high-impact ambiguity should produce one concise clarification or button confirmation.

## 176. Consequential end-to-end function trace
Trace at minimum:
1. natural action planner;
2. commissioner conversational handler;
3. action catalog / validator / executor;
4. confirmation service;
5. interaction router;
6. response lifecycle / guard;
7. Anthropic service;
8. team assignment/open teams;
9. league resolver;
10. provider sync orchestrator;
11. clean-slate reset;
12. progression reward claim;
13. membership lifecycle;
14. scheduler/advance engine;
15. R-mode Open House response pipeline.

Each trace must identify entrypoint, correlation ID, authority checks, canonical resolver, validation, confirmation, transaction owner, persistence, projection, retry/cancellation behavior, and terminal outcome.

## 177. Release gates
- No intent/parser layer performs authoritative mutation.
- Slash, button, natural language, and AI intents converge on the same application use case for the same operation.
- No exclusive architecture claim lacks a proving test.
- No new identical branch, fake condition, or duplicate logical state patch is introduced in touched code.
- AI calls have one timeout/cancellation/retry policy owner and cannot double-complete.
- High-impact mutation paths do not swallow failures.
- Guard responsibilities each have one documented owner.
- Natural-language regression tests cover paraphrases, slang, pronouns, follow-up context, ambiguity, and adversarial wording.
- R-mode/Open House conversational parity must survive the refactor.
- The consequential function traces must be completed before progression/postseason expansion becomes release-blocking.

## 178. Implementation order
1. interaction execution context;
2. canonical league/entity resolution;
3. membership/team assignment convergence;
4. ActionIntent/application-use-case spine;
5. AI timeout/cancellation/retry ownership;
6. guard ownership cleanup;
7. static maintainability gate;
8. remaining natural-language migrations;
9. progression/postseason consumers.

Non-regression rule: the internal pipeline becomes deterministic while the public conversation remains natural. If a semantically valid phrase worked before, the refactor must continue to understand it or ask a concise clarification rather than forcing more rigid syntax.



---

# Amendment v8 - Logic Reconciliation, Precedence, and Normative Corrections

## 179. Contract interpretation
- Historical findings remain evidence, not permanent runtime truth.
- The newest explicit requirement supersedes older conflicting recommendations.
- `MUST` is required for the named gate; `SHOULD` is the default unless an equivalent invariant is documented; `MAY` is optional and never mutation authority by itself.
- Static source counts are dated audit snapshots. Re-run them on the implementation branch; enforce invariants rather than old counts.

## 180. Release-gate taxonomy
- **G0 Integrity hotfix:** autocomplete/interaction lifecycle, clean-slate correctness, canonical league resolution, no hidden partial authoritative failure.
- **G1 Public beta:** core membership/team UI authority, truthful workflow wiring, logging redaction, typed critical failures, restart-safe enabled business timers.
- **G2 Progression/postseason:** versioned policies, wallets/entitlements, initial team grants, attribute caps, season/postseason models, tenure/forfeiture rules, provider verification and provenance.
- **G3 Scale/multi-guild:** load/concurrency, multi-instance dedupe, full guild scoping, mature observability, compatibility retirement.

Disabled future features do not block an earlier gate unless their code path is enabled or the gate explicitly names them.

## 181. UI reconciliation
- Target remains zero bot-rendered `StringSelectMenuBuilder` menus after migration.
- League/team/community/player mutation authority must not depend on autocomplete.
- Entity-authoritative autocomplete trends to zero; convenience-only autocomplete may remain if execution canonically re-resolves input.
- Discord-native user/attachment inputs remain. Compact stable enum choices may remain only when buttons add no material context/safety value.
- `/select-team` uses a league-scoped button/search flow; unambiguous channel/single-league context may pre-resolve league, otherwise league buttons precede team buttons.

## 182. Membership transaction rule
The earlier Option A/Option B fork is closed. Membership is the primary operation; optional team assignment is a follow-on. If membership succeeds but the requested team claim fails, persist `AWAITING_TEAM`, report the partial outcome, and notify the member. Do not roll back valid membership because an optional team became unavailable.

## 183. League lifecycle authority
- `listLeagueRecords`: diagnostics/history only.
- `listOperationalLeagues`: ACTIVE plus explicitly supported PAUSED records.
- `listJoinableLeagues` / team-claimable: ACTIVE only.
- Provider read sync may include PAUSED only when policy permits; competitive advance/mutation remains ACTIVE unless recovery explicitly says otherwise.
- Destructive actions resolve canonical identity, show impact, then confirm. No fuzzy destructive mutation.
- Synthetic `current` fallback never enters membership, provider, progression, reward, or destructive paths.

## 184. True clean slate
`/initialize-server` and trash-the-bot erase guild functional state, including product lifetime/member history that can affect future behavior. Security/audit evidence may be retained only in a non-hydratable store. Retained audit/provider-receipt rows must never reconstruct functional state. A separate irreversible purge handles eligible retained evidence when required. Reset is not successful until restart/hydration proves state does not return.

## 185. Progression ownership
- Initial team grants belong to team+season and never re-mint on owner change.
- Unspent earned member rewards and pending claims follow tenure forfeiture rules.
- Applied player mutations remain applied by default and retain provenance; do not blindly revert provider/natural progression.
- Reversal is allowed only when an explicit policy marks the mutation reversible and a verified baseline/provider rollback exists.

## 186. Data authority
- NOFUNBOT database/repositories own league policy, membership, tiers, entitlements, claims, progression provenance, and audit records.
- Validated external provider data owns provider/game facts such as current roster values, week, and results.
- JSON is migration/import/export/debug compatibility only after domain cutover.
- Each domain has one active write authority; dual-read/shadow compare is allowed, uncontrolled dual-write is not.

## 187. UI sessions, drafts, timers, and workflows
- `ComponentSession` is transient UI coordination and may fail closed on restart. It is never business authority.
- Long-lived/resumable configuration uses a durable Draft entity.
- Business deadlines persist intent/due time before timers are armed and must recover on restart.
- UX timeouts/debounce/cooldowns may be memory-only when loss cannot change authoritative state.
- Scheduler Registry wakes application use cases; timers do not directly mutate business state.
- Process Builder may author definitions, but Trigger Dispatcher + Workflow Engine are the only runtime execution path.

## 188. AI / natural-language convergence
Natural conversation remains the primary UX. Regex/NLP/AI adapters produce canonical `ActionIntent`; they do not own authoritative mutation. Slash, button, natural-language, and model-generated intents converge on the same application use case. `ActionCatalog` is canonical for model-generated tool actions only.

AI attempts use one timeout/cancellation/retry orchestrator and an attempt fence. A late result from a timed-out attempt cannot produce a second response or mutation after another attempt has won.

## 189. R Open House clarification
R may allow direct competitive insults, strong profanity, aggressive roast energy, and meme/GIF banter in configured lanes. The blocked boundary is protected-class hate, doxxing/private-data exposure, credible threats, coercion, persistent pile-ons after opt-out, and automated repeated targeting intended to intimidate or isolate. Direct sports roasting is not automatically classified as prohibited harassment.

## 190. Logic correction register
- Membership A/B fork -> settled on membership + explicit `AWAITING_TEAM` partial outcome.
- Autocomplete-first select-team wording -> superseded by button/search primary flow.
- PostgreSQL authority -> scoped to NOFUNBOT-owned records; provider/game truth remains provider-owned.
- Clean-slate preservation ambiguity -> functional state erased; retained security evidence non-hydratable.
- Every business deadline survives restart -> excludes transient UX timers.
- Static source counts -> snapshots, not permanent thresholds.
- All requirements release-blocking -> superseded by G0/G1/G2/G3 taxonomy.
- ComponentSession durability ambiguity -> transient UI only; durable Draft for resumable business flows.
- ActionCatalog universal-path wording -> scoped to model tool actions; application use cases are the convergence point.

## 191. Logic-consistency gate
- No unresolved architecture fork remains in an authoritative mutation path.
- No historical count is treated as a fixed target without a fresh scan.
- No future disabled feature blocks an earlier release gate by documentation accident.
- Every authoritative domain has a named owner and persistence boundary.
- Button/session and legacy inputs resolve to the same canonical use cases.
- Transient UI state cannot become business authority.
- Reset cannot hydrate retained audit evidence back into product state.
- R Open House remains natural/aggressive without per-layer policy contradictions.
- Natural-language refactoring cannot force rigid phrasing for semantically valid requests.
