# Install and Recovery

If the bot says `Missing dependency: discord.js`, run:

```bash
rm -rf node_modules package-lock.json
npm install
npm install discord.js
npm restart
```

If Prisma is already generating successfully, that part is healthy.
The `discord.js` error means your local dependency tree is still incomplete or stale.


## Local startup without Postgres
If you are running the bot in JSON-only mode, you can leave `DATABASE_URL` unset. The stack bootstrap scripts now skip cleanly instead of exiting with an error.

Use:
- `npm run start` for normal local bot startup
- `npm run stack:init` only when you actually want Postgres bootstrap + JSON migration

## v204.7 Provider and Conversation Recovery

- Passive conversation context is intentionally memory-only and is discarded on restart. Do not reconstruct it from message history automatically.
- Provider connections/sync runs/import receipts are durable. Recovery should hydrate those records first, then process queued/interrupted work idempotently.
- A push provider may be acknowledged only after its receipt/raw artifact is durable. After a crash, recovery should use the durable receipt rather than asking the upstream to resend as the primary strategy.
- In production keep PostgreSQL authoritative for provider receipts/connections. JSON compatibility overrides should remain disabled unless operating deliberately in degraded mode.
- Manual provider fallback preserves configuration so an unhealthy external source can be isolated without deleting recovery metadata.
- Never delete provider receipt/sync evidence during incident response. Roll application behavior back first.
