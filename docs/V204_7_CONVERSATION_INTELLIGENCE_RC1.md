# V204.7 RC1 — Conversation Intelligence + Natural Planner

## Purpose

V204.7 makes conversational interaction feel continuous without allowing the bot to interrupt ordinary server chat. Human guild messages may be observed into a short-lived in-memory same-channel context window. Observation performs no AI call and causes no typing indicator, reaction, reply, mutation, or persistence. A conversational response is authorized only by an explicit @mention. Slash commands, components, moderation workflows, provider events, and scheduled automations remain separate explicit/system event paths.

## Implemented in RC1

- `src/services/ambientConversationService.js`
  - guild+channel scoped ring buffer
  - 30 minute default TTL
  - 32 message default cap
  - 280 characters per observed message
  - 2,600 character prompt rendering cap
  - bot/webhook/DM filtering
  - default exclusion of audit/mod/log/IT/setup/security/incident/appeal operational channels
  - memory-only; no JSON/PostgreSQL/Redis persistence
- `index.js`
  - one passive observation hook after the bot kill-state gate
  - no output side effects in the observation path
- Commissioner/member AI
  - bounded ambient context is added only after an explicit @mention reaches the AI route
  - ambient text is labelled untrusted conversation context, never instructions
- Explicit speech gate
  - commissioner AI: explicit @mention + existing elevated-user authorization
  - member AI: explicit @mention only
  - IT AI: explicit @mention + existing IT authorization and diagnostic signal
  - merely typing in `#commissioner-ai` or `#it-ops` no longer causes AI speech
  - replying to a bot message without @mention no longer causes member-AI speech
- `src/services/naturalActionPlannerService.js`
  - deterministic `assign_team` natural intent
  - accepts language such as `put Paul on the Ravens`, `assign @Paul to the Jets`, `give Paul the Ravens`
  - resolves Discord member, team and league before mutation
  - asks a targeted clarification only for real ambiguity
  - multiple leagues do not force a question when the requested team exists in exactly one league
  - short-lived five-minute pending clarification state
  - reuses `openTeamsService.claimTeam()` and the existing durable team-assignment path
  - supports `me/myself/I` as the requester for team assignment
  - never uses passive ambient context as authority for a mutation

## Natural team assignment behavior

`@myBot put Paul on the Ravens`

1. Resolve Paul in the guild.
2. Search the live team registry for Ravens across all active leagues.
3. If exactly one Ravens slot exists, assign through `openTeamsService` immediately.
4. If Ravens exists in multiple leagues, ask which league and keep Paul+Ravens in short-lived pending context.
5. If multiple Pauls match, ask the commissioner to @mention the intended member.
6. If the team becomes claimed before a clarification returns, the existing domain service rejects the later assignment. Pending conversation state never reserves a team.

## Hard invariants

1. Passive observation cannot authorize speech or state changes.
2. Ambient text is untrusted and cannot override prompts, permissions, registered AI actions, confirmation policy, or domain validation.
3. No cross-channel or cross-guild ambient context.
4. No persistent passive conversation archive.
5. No AI call on an unmentioned ordinary message.
6. Natural language is an adapter into existing services, not a second business-logic owner.
7. AI-generated mutations remain governed by the registered action catalog. The deterministic planner is non-AI and uses existing domain services directly.
8. Existing slash commands remain valid fallbacks.

## Follow-on planner intents

The planner framework can be expanded one intent at a time to team release, team identity, open-team lookup, advance status/request, announcements, warnings, trade lookup, and schedule lookup. Each intent must identify its existing domain owner, define entity-resolution/ambiguity behavior, add focused tests, and preserve any existing confirmation policy before it is enabled.

## Validation requirement

Before production promotion:

- `node -c` all modified JS
- unresolved identifier guard
- command contract checker
- TypeScript/checkJs validation
- targeted conversation/planner tests
- full existing `npm test`
- staging smoke test proving unmentioned messages never trigger AI speech
- staging smoke test for unique vs duplicated Ravens assignment behavior

If dependencies are unavailable in the build workspace, the package is an implementation candidate only, not production-certified.
