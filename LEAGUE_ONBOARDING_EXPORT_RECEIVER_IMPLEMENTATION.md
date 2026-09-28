# NOFUNBOT League Onboarding + Temporary Export Receiver Implementation

## Live problems addressed

1. `/join-league` could expose a league option but fail autocomplete or fail to make the selected league visible through the rest of the flow.
2. Commissioner member placement could grant access without clearly naming the league in the result and without giving the target member a reliable onboarding notice.
3. Team assignment, timezone collection, and nickname updates were too loosely coupled. That creates confusing partial states when a member belongs to more than one league.
4. A member who already completed timezone onboarding could be asked to enter the same timezone again when using the legacy `/select-team` path.
5. External league-data intake had powerful provider plumbing but no simple commissioner workflow for obtaining a short-lived export destination URL.

## Implemented member model

- League ID is the first-class scope for membership, team ownership, access, and onboarding state.
- `/join-league` either honors the explicit league or presents a league picker first.
- Team options shown after that are league-scoped.
- Standard self-join flow is: league -> team -> timezone -> finalize claim -> nickname timezone suffix -> completion card.
- Commissioner placement is: member + exact league + optional team -> grant league access -> notify member -> member picks timezone -> nickname suffix -> onboarding complete.
- Commissioner accounts can also be players. Staff authority and player membership are separate concerns.
- Team identity is never placed into the guild-wide nickname because one Discord member can participate in multiple leagues. The nickname carries only the server-wide timezone suffix.
- `/select-team` can reuse a timezone already saved during onboarding, avoiding duplicate timezone entry.

## Member notification behavior

Commissioner placement now attempts both:

- a canonical in-server welcome card inside a league-owned channel with an interactive timezone picker; and
- a best-effort DM that names the league and assigned team when one was assigned.

The in-server card is authoritative because Discord DMs may be disabled and because component interactions need guild/member context.

## Temporary export receiver

The existing `/league-export` command now includes:

`/league-export receiver-url`

Required:
- exact active league
- provider (`Madden Companion export` or `NeonSportz webhook`)

Optional:
- validity in minutes, 5 to 10,080; default 60

Behavior:

- Generates a cryptographically random bearer token.
- Stores only the SHA-256 token hash in the provider connection registry.
- Returns the URL only in the commissioner-only Discord response.
- Madden Companion receives a short path such as `https://your-bot.example/x/<token>`.
- NeonSportz receives a short path such as `https://your-bot.example/n/<token>`.
- Existing long `/v1/providers/...` routes remain accepted for backward compatibility.
- Generating a new temporary URL rotates the token, invalidating the previous URL.
- Receiver tokens expire automatically using `receiverExpiresAt` in the connection config.
- Expired/incorrect tokens return the same non-revealing failure behavior as other invalid bearer tokens.
- The public Railway health server proxies both the long provider routes and the new short `/x/` and `/n/` routes to the internal provider receiver.
- Receiving an export does not automatically advance the league week. Import/sync and week advancement remain separate verified procedures.

### Why the bot does not use TinyURL

TinyURL is a redirector, not a data receiver. Using it would add an unnecessary third party that sees the bearer URL and creates another availability/privacy dependency. The built-in short route provides the same copy/paste convenience while keeping routing and token rotation under NOFUNBOT control.

## Required production environment

For temporary receiver URLs:

- `ENABLE_PROVIDER_HTTP=true`
- `PUBLIC_BASE_URL=https://<your-public-bot-domain>` or Railway-provided `RAILWAY_PUBLIC_DOMAIN`
- `PROVIDER_HTTP_PORT` must remain different from public `PORT`; the health server proxies public receiver traffic internally.

Production provider connections should use the configured durable database path. Do not replace production secrets with placeholders just to satisfy preflight.

## Validation added

`tests/temporaryReceiver.regression.test.js` verifies:

- short Madden receiver URL generation;
- legacy Madden URL compatibility;
- exact league token resolution;
- URL rotation invalidating the previous token;
- expiration rejection; and
- short NeonSportz route generation.

The focused receiver regression currently passes 7/7. All modified JavaScript files pass `node --check` in the working container.

Before deployment, run in the migrated VS Code repository:

```bash
npm ci
npm test
npm run tsc
npm run release:verify
npm run deploy:preflight
```

Do not deploy if any gate fails.

## Final validation correction after new-folder migration

The first full run in the newly extracted folder exposed two `templateFallbacks.test.js` assertions that still encoded the **old** nickname contract. The implementation intentionally changed the contract so the guild nickname gains a timezone suffix after onboarding while team identity stays league-scoped. The tests were updated to match that intended behavior:

- a member named `Player` with Pacific Time now expects `Player (PDT)`;
- a custom guild nickname such as `My chosen name` becomes `My chosen name (PDT)` after the member selects a timezone;
- a legacy bot-owned team nickname such as `Lions (PDT)` migrates to the member identity plus timezone, e.g. `Player (PDT)`;
- a manual nickname change after bot assignment remains protected from being silently overwritten;
- league A/B team identity is still read from league-scoped team ownership, never from the guild nickname.

A dedicated `tests/leagueOnboarding.regression.test.js` was added to cover exact-league notification, assigned-team notification, no-team next-step guidance, timezone selector ownership, timezone nickname behavior, and legacy team-nickname migration.

The Git migration also has a documented recovery path in `GIT_MIGRATION_RECOVERY.md`. The aborted checkout did not damage the fixed source tree; it only left the new folder on a disconnected root `main` commit. Do not force-push that root commit. Reattach it to `origin/fix/v1-clean-slate-multiparty`, restore the safety-branch tree, validate, then push `fix/v1-onboarding-export-receiver`.
