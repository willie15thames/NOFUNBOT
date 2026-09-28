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
- League onboarding now names the exact league, scopes team choices to that league, notifies added members, collects timezone before nickname updates, and keeps team identity league-specific.
- Commissioners can generate short-lived inbound export URLs for Madden Companion or NeonSportz so external league data can be pushed directly into the bot without a permanent public token.
- Conversational AI can now understand Discord-hosted images, memes, animated GIFs, stickers, and sampled short-video frames, then carry a safe semantic description into short-lived conversation context.

- League and team actions now re-check exact league scope at execution time so autocomplete failures or similarly named teams cannot silently target the wrong league.
- Bot-generated choice menus now use button panels backed by short-lived server-side sessions instead of Discord string-select dropdowns.
- R-mode Open House can join configured social/trash-talk lanes naturally while keeping operational channels quiet and preserving safety boundaries.
- AI request timeout/retry handling now has one cancellation owner, reducing duplicate in-flight attempts after timeouts.
- Workflow status now distinguishes live, manual, and dormant flows instead of treating registration alone as active automation.
- Delayed POTW work and Pacific-time scheduling are more restart-safe and daylight-saving aware.

> Internal RC, test, migration, CI, and engineering notes are intentionally not published to league users.
