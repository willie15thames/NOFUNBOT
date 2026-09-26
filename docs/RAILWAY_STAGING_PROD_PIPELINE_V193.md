# Railway staging -> production pipeline (V193)

## Goal
Ship the same commit to staging first, then promote that exact commit to production with minimal downtime.

## Recommended Railway variables

### Staging
```env
APP_ENV=staging
RELEASE_CHANNEL=beta
RUN_PRISMA_MIGRATIONS_ON_BOOT=true
RUN_DB_BOOTSTRAP_ON_BOOT=true
RUN_JSON_MIGRATION_ON_BOOT=false
ENABLE_QUEUE_WORKER=true
BOT_DATA_DIR=/data
```

### Production
```env
APP_ENV=production
RELEASE_CHANNEL=stable
RUN_PRISMA_MIGRATIONS_ON_BOOT=true
RUN_DB_BOOTSTRAP_ON_BOOT=true
RUN_JSON_MIGRATION_ON_BOOT=false
ENABLE_QUEUE_WORKER=true
BOT_DATA_DIR=/data
```

## Recommended deploy flow
1. Push code to the branch connected to Railway staging.
2. In staging logs, confirm these entries appear:
   - `[predeploy-check] Required files present ✅`
   - `[release-context] ...`
   - `[health] ok`
   - `[railway-start] Starting bot...`
3. Verify the bot responds in Discord and `/health` returns deployment JSON.
4. Promote the same commit to production.
5. Re-check `/health` and the first production logs.
6. If production misbehaves, use Railway Deployments -> previous deployment -> Redeploy.

## One-time JSON -> Postgres migration
Only enable this for an intentional data move:

```env
RUN_JSON_MIGRATION_ON_BOOT=true
```

After the migration finishes and data looks correct, set it back to `false`.

## Why this is safer
- Prisma migrations can stay on for normal deploys.
- JSON migration is off by default, so repeated production deploys do not replay a risky one-time step.
- Worker startup can be disabled without changing code.
- `/health` exposes deploy context for quick rollback decisions.
