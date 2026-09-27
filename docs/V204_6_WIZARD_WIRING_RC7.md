# V204.6 / 21.10.0-rc.7 — Wizard, reconciliation, and command wiring repair

Date: 27 September 2026

## Why this patch exists

The RC6 safety work correctly refused to delete Discord resources without proven bot ownership, but a normal full template build did not seed the template ownership manifest. That made a later edit unable to distinguish obsolete generated channels from untracked lookalikes, so removed template channels could remain indefinitely. The setup wizard also carried two overlapping concepts for the same choice: a legacy Standard/Custom setup mode and the newer BASE/CUSTOM/EMPTY structure strategy. Those values could disagree, and the legacy Standard value could silently force BASE at build time.

The screenshots that triggered this patch also exposed a command-UX gap: community deletion accepted free text even though the operation requires the exact persisted community name, and league-qualified team autocomplete values could reach team mutation handlers without being decoded.

## Implemented changes

### 1. One structure authority in the setup wizard

The current wizard renders Structure Strategy as the single build choice:

- **BASE**: core server lanes plus the selected template.
- **CUSTOM**: core lanes plus only the selected custom packs.
- **EMPTY**: selected template plus staff/setup controls, without the standard community stack.

The redundant current-flow `Custom Bot Setup Selected` control is removed. The legacy component handlers remain so stale Discord messages fail gracefully, but they no longer decide what gets built. The build path reads `customStructureMode` directly.

The custom step no longer blocks completion on `customArrangementMode`, because that value was not an effective build authority in the existing implementation. Custom builds retain the established safe auto-arrangement behavior.

### 2. Initial builds seed reconciliation ownership

`templateReconciliationService.recordDesired()` records the exact ID, name, topic, parent and category ownership of generated template resources after a successful full build. A later edit can now compare the desired template to those owned resources and remove unchanged obsolete channels/categories.

The RC6 safety contract is preserved: renamed, moved, retopiced and manual lookalikes are not adopted merely because they resemble generated content. A pre-RC7 server with no ownership manifest therefore remains conservative on its first edit. Use an explicit reviewed migration or a clean rebuild if legacy untracked assets must be adopted; do not weaken the deletion guard to guess ownership from names/topics.

### 3. Team identity is league-scoped, not a Discord nickname

`/set-team-identity` now decodes autocomplete values in the form `team::leagueId`, validates the encoded league against the current space when applicable, and updates only the scoped player/team registry entry. It does not rename the Discord member. Discord provides one native nickname per server, so cross-community identity belongs in scoped bot data/content.

`/register-team` receives the same league-qualified decoding. The router scope guard now covers the team mutation commands that can collide when several leagues are active.

### 4. Community command targets use real saved names

`/edit-community`, `/delete-community`, and `/toggle-team-mode` now autocomplete persisted community names/types. This prevents a commissioner from guessing a display/category name such as `gaming` when the stored community key has a different exact value.

### 5. Installation state has one owner

Guild-install detection and command deployment now query `wizardStateService` for installation mode instead of the retired `wizardPreferences` field.

### 6. Natural-language team assignment has a deterministic fallback

A commissioner message such as `assign @member to the Kings` is not an AI-executable action in the registered catalog. It now bypasses the model and replies with the actual `/teams assign team:<team> user:<member>` path. The commissioner prompt also explicitly separates team assignment from `/set-team-identity`, which is branding/display identity only. This prevents the observed privacy-style answer and mixed prose/JSON planner failure for this common command-shaped request.

## Verification performed in this workspace

- `node --check` passes for the modified JavaScript files.
- `node scripts/check-undefined-identifiers.js` passes.
- `node scripts/command-contract-check.js` passes with 116 command definitions, 129 router cases, and the expected classified legacy/internal cases.
- A focused regression test was added for ownership seeding followed by template cleanup.

The full local regression suite is **not certified in this workspace**. Project dependencies were absent, `npm test` failed at module loading, and an `npm ci` attempt timed out. Run the normal clean-install release gate before merging or deploying.

## Required staging checks

1. On a fresh staging server, build one template, then edit to a template that removes at least one generated channel. Confirm the unchanged obsolete owned channel disappears and a manually renamed/moved/retopiced channel survives.
2. Select BASE, CUSTOM, and EMPTY in separate clean staging runs and confirm the built structure matches the definitions above. Confirm no legacy Standard/Custom setup state overrides the chosen strategy.
3. With two active leagues sharing a team name, run register/release/identity operations from each league context. Confirm only that league changes.
4. Confirm `/set-team-identity` changes the league-scoped display identity and never flips the Discord nickname when the member posts in another community.
5. Run community edit/delete from autocomplete rather than guessed text. Remove the bot's delete permission once to confirm the RC6 repair journal reports partial failure rather than false success, then restore permission and retry.
6. Complete the existing RC6 PostgreSQL CI, Discord permission, worker recovery, provider round-trip, and backup-restore gates before production.
