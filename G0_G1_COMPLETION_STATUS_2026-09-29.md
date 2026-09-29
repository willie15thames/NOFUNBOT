# Contract v8 G0/G1 implementation handoff

Date: 2026-09-29 UTC (2026-09-28 Pacific)

## Scope completed and verified locally

### G0 integrity
- Autocomplete responds through its own lifecycle, including membership denial and entrypoint failure. A denied autocomplete test proves exactly one `respond([])` and zero chat replies.
- League/team operations re-resolve current canonical identity and status at execution. Caller-supplied league objects and encoded team values cannot override the current guild or an explicit league choice. Natural-language and slash assignment use the same application use case.
- Team claims reject synthetic, archived, wrong-guild, and ambiguous scopes. A failed access rollback cannot present a durably claimed team as open.
- Clean slate clears durable membership, assignment, league-removal journals, game sessions, scoped per-league runtime files, and database progression/season/postseason records. It cancels registered timers and reports failures instead of claiming success. Reset completion waits for all cached state writes to reach configured PostgreSQL.
- The restart-style local test seeds old membership, owner, game session, and scoped state, resets, then verifies none can rehydrate.

### G1 public beta implementation
- `/select-team` can launch the button-first league/team/timezone flow; optional typed inputs are canonically re-resolved. A stale join panel rejects an archived league.
- Component sessions for member onboarding, timezone prompts, and community selection bind guild/actor appropriately. Missing guild or actor context fails closed for a bound session.
- Critical post-build workflow failures stop a successful reset report; optional patch notes and identity failures remain visible in workflow results. The post-trash guide refresh is awaited.
- Audit details receive recursive secret redaction before in-memory buffering, database writes, and logs. The interaction entrypoint redacts fatal errors.
- POTW due-at and retry state are saved durably before a process timer is armed. Hub-week reset durably cancels the deadline. The existing automation engine is guild-scoped on startup.
- `/edit-message` remains available as `/workflow edit-message` within Discord's 100-command limit.

## Local verification

- `npm run release:verify` with isolated test environment: **41 test files, 0 failed**. Test credentials are placeholders; this does not contact Discord.
- `npm run tsc`: passed.
- Contract v8 static and G2/G3 static/regression checks: passed.
- Undefined identifier scan: passed.
- Added regression coverage for autocomplete denial, reset/hydration, button league selection, canonical assignment, component isolation, redaction, and fail-fast workflow/deadline handling.

## External acceptance still required

This artifact is **not a live public-beta deployment sign-off**. The following cannot be proven in this workspace because it has no actual Discord token, PostgreSQL service, provider credentials, or staging guild:

1. Run the contract's live Discord autocomplete and two-league, same-team sequence.
2. Run `npm run deploy:preflight` and database migrations against the intended PostgreSQL instance; reset and restart to verify hydration with real database rows.
3. Exercise a real member/commissioner join, team claim, timezone, button expiry, archived league, and workflow failure in staging.
4. Confirm timer recovery after a real process restart and provider/queue outages.

G0/G1 local implementation and automated gates pass. Production acceptance remains open until these external checks pass. G2/G3 production integration is a separate remaining contract scope; its domain foundations passing static tests does not establish live readiness.
