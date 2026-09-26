# Stack Upgrade Notes

This package now includes starter scaffolding for:
- TypeScript
- PostgreSQL via Prisma
- BullMQ + Redis

What is included now:
- package.json dependency and script updates
- tsconfig.json
- prisma/schema.prisma starter models
- src/queue/worker.js starter worker

What still needs to be done by you in a real environment:
1. Run `npm install`
2. Set `DATABASE_URL`
3. Set `REDIS_URL`
4. Run `npx prisma generate`
5. Run `npx prisma migrate dev --name init`
6. Decide which JSON stores move to Postgres first
7. Deploy the Redis-backed worker if you want async jobs

This is scaffolding, not a full migration yet.
