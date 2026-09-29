# NOFUNBOT Contract v8 - Current Completed Work

Date: 2026-09-29

## Gate status

- G0: 100% code complete
- G1: 100% code complete
- G2: 100% code complete
- G3: 100% code complete
- Contract v8: 100% code implementation complete

## G2 completion added in this handoff

- Automatic canonical PostgreSQL projection for league/team membership lifecycle.
- Stable membership identity through team transfer and correct departure-only forfeiture.
- Durable legacy progression migration/review queue and commissioner `migrate-legacy` cutover.
- Explicit non-lossy reward overflow modes: REJECT, BANK_LOCKED, CONVERT, EXPIRE.
- Mapped provider evidence for Companion Export, NeonSportz, and Custom URL.
- PostgreSQL integration test for tenure continuity/forfeiture.
- `g2:certify` staging/production data-readiness gate.

## Verified locally without external dependencies

- G2/G3 targeted regression: 37/37 PASS.
- Live-cutover regression: 1/1 PASS.
- Contract G2/G3 static gate: PASS.
- Main contract static gate: PASS.
- Dependency cycle gate: PASS, 0 SCCs.
- Undefined identifier gate: PASS.
- Command contract: PASS.
- JavaScript syntax: PASS.

## Required staging certification

The working container has no `node_modules` and no live database/Discord/provider stack. Run `npm ci`, migrations, `npm run tsc`, `npm run test:postgres`, `npm test`, `npm run g2:certify`, `npm run release:verify`, and two-league Discord/provider staging before production enablement.
