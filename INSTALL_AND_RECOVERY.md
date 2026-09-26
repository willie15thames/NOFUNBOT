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
