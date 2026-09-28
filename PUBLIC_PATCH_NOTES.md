# NOFUNBOT Public Patch Notes

## v1.0.0 — Public Beta

- Initial public beta release for live Madden league use.
- Server setup supports Base, Template, and Custom structures.
- Madden league creation, team claiming, league workflows, trades, schedules, results, standings, and commissioner controls.
- Natural commissioner requests can route into approved domain actions while preserving permissions and validation.
- Madden provider framework supports approved Companion/Neon/custom/manual data paths with durable recovery controls.
- Runtime stability, recovery, and production observability are enabled for the public beta.
- Multi-person bot conversations now keep speaker-aware shared channel context, including replies to the bot without requiring a fresh mention.
- Phantom managed league slots are repaired automatically so stale hidden records cannot block new league creation.
- `/initialize-server` and the full reboot path now clear guild bot memory, league state, setup settings, and user-facing persisted history before rebuilding installation mode.

> Internal RC, test, migration, CI, and engineering notes are intentionally not published to league users.
