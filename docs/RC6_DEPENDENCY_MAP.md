# RC6 repair dependency map

Baseline: package 21.10.0-rc.5, including existing uncommitted RC3–RC5 changes.
No existing changes are discarded. This map precedes shared-service edits.

| Owner | Callers and compatibility boundary | Repair |
| --- | --- | --- |
| templateReconciliationService | baseInitService applyEditChanges, template tests | Never re-adopt edited manifest entries through legacy heuristics |
| leagueVisibilityService | openTeamsService, event router, release paths | Durable pending membership, compensation and repair states |
| scopedState players | openTeams, team assignments, hydration, set-team-identity | Canonical keys; preserve explicit qualified keys and existing owners |
| eventSpaceService | setup-event router | Publish active projection last; remove failed projection on rollback |
| gameResultService | router, component flow, advanceEngine getters | Lifetime/result/standings revision committed together; synchronous getters remain projections |
| lifetimeHistoryService | results, awards, streams, member-record, member lifecycle | Pure mutation helpers within existing critical transaction authority |
| guildLockService | router destructive handlers, advanceEngine | Shared structural lock; advance locks retain league scope |
| httpIntake | attachments, avatar, providers, live sync | Private-address normalization and validated DNS connections |
| leagueFeatureService | automationAccess, active-check responses/router | Per-league error isolation, notified audience snapshot, accurate wording |
| nicknamePolicyService | index, timezone handlers, claims | Provenance required for automatic legacy cleanup |
| streamCreditService | message routing | URL recognition; cooldown and source identity survive reward rollover |
| spaceAutoGenService deletion | delete-community router | Retain ownership until all deletes succeed; retry partial deletion |
| readinessService | index, health sidecar, Railway supervisor | Fresh dependency status and lifecycle supervision |

Regression gates: existing suite, new failure assertions, syntax/identifier/type checks,
database transaction and recovery tests when available. Discord acceptance remains a staging gate.
Do not deploy known P1 faults. Database and volume backups precede rollout.
