#!/usr/bin/env bash
set -euo pipefail

printf '\n[NOFUNBOT v204.7] clean release gate\n'
printf '1/7 Installing locked dependencies...\n'
npm ci
printf '2/7 Generating Prisma client...\n'
npm run prisma:generate
printf '3/7 Validating Prisma schema...\n'
npx prisma validate
printf '4/7 Running complete historical + current test suite...\n'
npm test
printf '5/7 Running TypeScript validation...\n'
npm run tsc
printf '6/7 Running aggregate release verifier...\n'
npm run release:verify
printf '7/7 Running deployment preflight...\n'
npm run deploy:preflight
printf '\n[NOFUNBOT v204.7] ALL RELEASE GATES PASSED.\n'
printf 'Database migrations are intentionally not auto-applied by this script. Run npm run prisma:migrate:deploy against the intended deployment database during the controlled deployment step.\n'
