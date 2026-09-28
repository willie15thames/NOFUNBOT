# NOFUNBOT v1.0.0 Public Beta — Clean Slate + Multi-Person Conversation Fix

This build addresses the live failures reproduced in the September 27 test server.

## Fixed

### 1. Multi-person bot conversations now share channel context
- Direct bot conversations keep a short-lived shared channel thread in addition to each user's private/session lane.
- Speaker labels are preserved so the model can distinguish different members and commissioners.
- Replies to a bot message count as an explicit continuation even when the user does not mention the bot again.
- Permission checks remain tied to the current Discord member. Shared context never grants another user's permissions.

### 2. Hidden leagues no longer block `/setup-league`
- Managed-space capacity is repaired against the canonical active-league registry before capacity is counted.
- Orphan `ACTIVE`/`PAUSED` managed rows are auto-archived if no canonical league/event exists.
- `REPAIR_REQUIRED` and `ARCHIVING` rows do not consume a live slot.
- Abandoned `PREPARING` reservations expire and archive after the configured TTL.
- `/initialize-server` also clears the managed-space store and the legacy active-league registry.

### 3. `/initialize-server` is a true bot-memory clean slate
It now clears guild-scoped bot state before rebuilding the setup lane, including:
- direct and shared conversation history
- ambient conversation memory
- active league registry and managed-space reservations
- lifetime/member history and member profiles
- server settings, rules, wizard preferences, and wizard state
- template/build/component state and pending league workflow files
- guild-scoped database setup/community/league/member/moderation state
- provider state tied to leagues belonging to the guild

Operational runtime incident telemetry is intentionally retained so a reset cannot erase the evidence needed to debug a production failure. The currently-running background reset job is also retained so initialization can finish cleanly.

### 4. Full reboot uses the same clean-slate contract
`/trash-the-bot` now calls the same clean-slate reset service instead of running a smaller, inconsistent reset path. This also fixes the previous undefined `memoryReset` completion reference.

## Verification performed in this workspace

Passed targeted regressions:
- multi-person shared context: **10/10**
- clean-slate reset contract: **10/10**
- orphan managed-space repair: **5/5**
- existing managed-space regression: **5/5**
- conversation awareness: **10/10**
- message routing: **7/7**
- natural planner: **36/36**
- provider contract/durability/fault regressions: passed
- runtime incident regression: **6/6**
- speech gate: **4/4**
- structure semantics: **7/7**
- trade flow: **6/6**

All changed JavaScript files passed `node -c` syntax validation.

## Important local verification note
A full `npm test`/TypeScript release gate could not be completed in this sandbox because `npm ci` was interrupted before dependencies finished installing. The resulting `node_modules` contained empty/incomplete packages such as `discord.js`, so dependency-based tests failed with `MODULE_NOT_FOUND`. This is an environment/install failure, not a claimed passing release gate.

Before production deploy, run from a clean checkout with working network/package installation:

```bash
rm -rf node_modules
npm ci
npm test
npm run tsc
npm run release:verify
npm run deploy:preflight
```

Do not deploy if any of those gates fail.

## Live smoke test after redeploy

1. Run `/initialize-server` once.
2. Complete Base Structure.
3. Run `/setup-league` and confirm no phantom league capacity error appears.
4. If an old phantom row existed, confirm it does not consume a slot.
5. Have Person A mention the bot, Person B reply in the same thread/channel, then Person A reply to the bot without a new @mention.
6. Confirm the bot keeps speakers separate and follows the shared topic.
7. Run `/delete-league` or `/reset-league` only after a real canonical league exists and verify the league shown is the same one the capacity system sees.
