# Railway Redis + Postgres Setup (Step-by-Step)

## 1. Add Postgres
1. In Railway, open your project.
2. Click **New** -> **Database** -> **PostgreSQL**.
3. Wait for it to finish provisioning.
4. Open the Postgres service -> **Variables**.
5. Copy `DATABASE_URL`.
6. Open the bot service -> **Variables**.
7. Add `DATABASE_URL` with the copied value.

## 2. Add Redis
1. In Railway, click **New** -> **Database** -> **Redis**.
2. Wait for provisioning.
3. Open the Redis service -> **Variables**.
4. Copy `REDIS_URL`.
5. Open the bot service -> **Variables**.
6. Add `REDIS_URL` with the copied value.

## 3. Add persistent volume
1. Open the bot service -> **Volumes**.
2. Add a volume.
3. Mount it at `/data`.
4. In bot service variables add `BOT_DATA_DIR=/data`.

## 4. Recommended bot variables
- `NODE_ENV=production`
- `PORT=8080` (Railway usually injects this automatically)
- `COMMISSIONER_ROLE_ID=<discord role id>`
- `DISCORD_TOKEN=<bot token>`
- `CLIENT_ID=<discord app id>`
- `GUILD_ID=<guild id>`

## 5. After variables are set
Redeploy the bot service. Watch logs for:
- `[railway-start] ✅ BOT_DATA_DIR=/data (persistent)`
- `[railway-start] Running Prisma migrations...`
- `[worker] storage-sync ready` or queue-ready log
- No warnings about missing `DATABASE_URL` or `REDIS_URL`

## 6. Health checklist
- `/manual` replies immediately
- `/initialize-server` creates a status card and completes
- `/trash-the-bot` returns fast and runs as a real background job
- Restart the service and confirm state survives

## 7. Failure patterns
- If `DATABASE_URL` is missing, Prisma writes are disabled and state will not persist.
- If `REDIS_URL` is missing, queued jobs fall back to in-process execution.
- If `BOT_DATA_DIR` points to `/tmp`, JSON fallback state is wiped on restart.
