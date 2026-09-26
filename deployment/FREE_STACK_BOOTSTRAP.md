# Free Stack Bootstrap

## What is included
- TypeScript build pipeline through `tsc`
- PostgreSQL persistence for bot JSON state through `BotKv`
- Redis + BullMQ queue for background storage sync jobs
- Docker Compose for local free infrastructure
- Railway deployment file for production wiring

## Local bootstrap
1. Copy `.env.example` to `.env`
2. Run `docker compose up -d postgres redis`
3. Run `npm install`
4. Run `npm run prisma:generate`
5. Run `npm run db:bootstrap`
6. Run `npm run db:migrate-json`
7. Run `npm run start`
8. In another terminal run `npm run queue:worker`

## Free hosting pattern
- Railway or Render for the app service
- Railway Postgres or Neon free tier for database
- Upstash Redis or Railway Redis for queue backing

## Notes
The bot still keeps JSON files as a warm local cache. Postgres becomes the durable persistence layer once bootstrapped.
