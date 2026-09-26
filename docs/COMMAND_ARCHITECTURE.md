# NOFUNLEAGUE Command Architecture (V203)

Measured from the code, not estimated. Re-measure with `npm test` (tests/commandRegistry.test.js).

## Current state (verified)

```
                              DISCORD
                                 │
          112 command definitions (src/commands.js) + 2 context menus
                                 │
        applyGroupedAliases  (src/services/commandAliasService.js)
          12 legacy admin tools nested into permission-matched groups
                                 │
            100 top-level slash commands registered (Discord cap)
            ├─ 88 flat commands
            └─ 12 group commands: game-channels, teams, waitlist, streams,
               broadcasts, player, logger, security-audit, ban,
               member-record, league-export, workflow
                                 │
   index.js interactionCreate → resolveInteractionAlias (legacy name restored)
                                 │
          interactionRouter → validation / security / install-mode gates
                                 │
                 service layer (src/services, src/league, src/actions)
                                 │
     jsonStore (BOT_DATA_DIR, dual-write Postgres when DATABASE_URL is set;
                Redis optional: event claims, BullMQ storage-sync worker)
                                 │
          provider layer (src/providers: local, Madden Companion export,
                          NeonSportz, custom endpoint, NBA 2K)
```

Corrections to the earlier estimate:
- `COMMAND_TRIM_PRIORITY` has 19 entries, but only **12** commands were actually cut in v201/V202.
  Trimming removes the first overflow-count matches in builder order, so 7 listed names were never cut.
- **V203: 0 commands are cut.** All 112 definitions are reachable.
- The router has 129 `case` labels: 112 are defined commands, 17 are legacy routes with no definition (below).

## What V203 changed

The 12 previously cut commands are registered as subcommands of existing admin-only groups. Their definitions,
options, handlers, validation classes, install-mode rules and permission checks are unchanged. The only
difference is the Discord path:

| Legacy (unreachable before V203) | Now |
|---|---|
| /hub-status | /game-channels hub status |
| /clear-hub | /game-channels hub clear |
| /cancel-release-timer | /game-channels hub cancel-release-timer |
| /cancel-potw-timer | /game-channels hub cancel-potw-timer |
| /repost-schedule | /game-channels schedule repost |
| /schedule-registry-status | /game-channels schedule registry-status |
| /live-sync-status | /game-channels live-sync status |
| /live-sync-now | /game-channels live-sync now |
| /set-league-source-mode | /game-channels live-sync source-mode |
| /restore-stream | /streams restore |
| /process-builder (create/list/inspect/toggle/delete) | /workflow process-builder … |
| /process-run | /workflow process-run |

How it works:
1. **Registration.** `applyGroupedAliases` moves each legacy command's own JSON into its container.
   - It refuses to build (throws) if the container's permissions differ from the legacy command's.
   - It also refuses on a name collision, more than 25 options at any level, or a container payload over 8000 bytes.
2. **Routing.** `resolveInteractionAlias` runs first in `interactionCreate` and again, idempotently, in the router.
   - It rewrites `interaction.commandName` back to the legacy name before any gate reads it.
   - Options are hoisted by discord.js, so legacy handlers read their options unchanged. This is verified with the
     real `CommandInteractionOptionResolver`.
3. **Fail-closed.** If resolution were ever skipped, the `game-channels`, `streams` and `workflow` cases detect an
   aliased path and refuse to run anything. Without this guard, `/game-channels live-sync now` would otherwise fall
   into the `notify` catch-all.
4. **Guides and manual.** Command paths in the guides and `/manual` are generated from the same spec, via `displayPath`.

The other 100 top-level commands are byte-identical to V202. A test pins that set.

## Legacy router cases with no command definition (17)

These are unreachable from Discord: nothing registers them and no alias targets them. They are kept unchanged,
because deleting code is outside a no-regression release.

| Case | Status |
|---|---|
| schedule-export-current, schedule-export-all | Superseded by `/league-export current`, `/league-export all-weeks` |
| add-member-note, inactive-members, check-inactive | Superseded by `/member-record add-note`, `/member-record inactive` |
| set-weekly-automation, weekly-automation-status | Superseded by `/game-channels automation`, `/game-channels status` |
| manual-server, manual-league, manual-setup, manual-commands, manual-actions | Superseded by `/manual` |
| setup-bot, kill-bot, ignite-bot, bot-status | No registered equivalent. Referenced only by install-mode and hierarchy allowlists. Needs an owner decision: define them (e.g. a future `/bot` group) or remove them in a cleanup release. |
| post-server-guide | No registered equivalent. It has a validation class and a channel requirement. Same decision needed. |

## Target architecture and how to get there without regressions

```
                              DISCORD
                                 │
                  ~15–25 top-level groups + buttons
                                 │
             command handlers (router cases keyed by stable names)
                                 │
                          domain services
          ┌──────────────┬───────────────┬──────────────┬──────────────┐
     League engine   Scheduler        Sync engine     AI engine
     src/league/     leagueAutomation leagueSync      src/actions/
     advanceEngine   Service +        Service +       actionCatalog +
     + runtime       hubRelease timer providers       commissionerPrompt
          └──────────────┴───────────────┴──────────────┴──────────────┘
                                 │
                     PostgreSQL / Redis (via jsonStore)
                                 │
                 provider layer → Madden / 2K / future games
```

The alias layer is the migration mechanism. Moving any command into a group is a one-line entry in
`GROUPED_ALIASES`, with no handler changes. The tests check permissions, limits and routing automatically.

Consolidating the 88 flat top-level commands **renames commands members already use**. Discord cannot show the old
and new names at the same time without exceeding the 100-command cap. That is a user-facing change, so it is not
done automatically. Recommended phases, each needing commissioner sign-off:
1. **Commissioner-only tools first** (members never type them): hub/schedule/data/admin commands into
   `/game-channels`, `/league-export`, `/logger`, `/security-audit`.
2. **Member commands last, with notice.** Announce in #announcements and update guides (they update automatically
   via `displayPath`). Keep the router cases keyed on the legacy names.
3. **Freed slots go to new domain groups** (for example `/league`, `/bot`) instead of new flat commands.

Rule going forward: **no new top-level commands.** New controls go into an existing group, and the league advance
controls stay under `/game-channels`.
