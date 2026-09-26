# Railway Remote Deployment Guide (v158)

## If you are hosting for someone else
Use one Railway project per customer or environment.

Required services:
- App service
- PostgreSQL service
- Redis service
- Volume mounted at `/data`

Required app variables:
- `DISCORD_TOKEN`
- `CLIENT_ID`
- `GUILD_ID`
- `BOT_DATA_DIR=/data`
- `DATABASE_URL`
- `REDIS_URL`

## Important DATABASE_URL rule
- `postgres.railway.internal` works only inside Railway.
- If you are running locally, use the public connection string from Railway instead.
- The URL must start with `postgresql://` or `postgres://`.

## Quick operator checklist
1. Add Railway Postgres.
2. Add Railway Redis.
3. Add a Railway Volume and mount it at `/data`.
4. Set `BOT_DATA_DIR=/data` in the app service.
5. Paste the Postgres `DATABASE_URL` into the app service variables.
6. Paste the Redis `REDIS_URL` into the app service variables.
7. Run `npm run infra:check`.
8. Deploy.
