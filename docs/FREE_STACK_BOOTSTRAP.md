# Free-ish Local Bootstrap Path

Use the current JS bot now, then migrate in layers:

1. Keep Node.js + discord.js live
2. Add Postgres models for guild settings, member profiles, queue audit, and wizard state
3. Add BullMQ for resets, channel builds, weekly board refreshes, and heavy sync jobs
4. Migrate hot paths to TypeScript first:
   - setup wizard
   - settings service
   - interaction router
   - queue worker

The zip includes the starter files, but your environment still needs install + database + redis wiring.
