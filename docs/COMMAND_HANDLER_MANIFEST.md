# Command Handler Manifest — v203 Stabilization

This document classifies `interactionRouter` cases that are intentionally not public top-level slash commands.
Public command visibility remains frozen; compatibility behavior is routed through grouped commands or replacements.

## Public grouped compatibility paths added by stabilization

- `kill-bot` → `/workflow bot kill`
- `ignite-bot` → `/workflow bot ignite`
- `bot-status` → `/workflow bot status`
- `post-server-guide` → `/workflow guide republish`

The router still receives the legacy name after `commandAliasService` rewrites the interaction, so permissions,
validation, killed-mode gates, and existing handler behavior remain unchanged.

## Router-only compatibility handlers

| Legacy/internal case | Public replacement / status |
|---|---|
| `add-member-note` | `/member-record add-note` |
| `check-inactive` | `/member-record inactive` |
| `inactive-members` | `/member-record inactive` |
| `manual-server` | `/manual section:server` |
| `manual-league` | `/manual section:league` |
| `manual-setup` | `/manual section:setup` |
| `manual-commands` | `/manual section:commands` |
| `manual-actions` | `/manual section:actions` |
| `schedule-export-current` | `/league-export current` |
| `schedule-export-all` | `/league-export all-weeks` |
| `set-weekly-automation` | `/game-channels automation` |
| `weekly-automation-status` | `/game-channels status` |
| `setup-bot` | `/setup-wizard-start` |

Do not add a new router-only case without documenting its public path and adding it to
`scripts/command-contract-check.js`. Do not delete a compatibility handler until searches/tests prove that no
component, alias, workflow, or historical interaction can route to it.
