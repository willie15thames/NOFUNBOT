# G2 implementation handoff

## Gate status

**G2 Contract v8 code implementation is complete in this package.** The progression/postseason domain, legacy cutover path, membership-tenure projection, provider verification, overflow policies, durable migration review queue, and production certification checks are implemented. Live deployment certification remains an environment step and is not represented as having run inside this dependency-free build container.

## Completed G2 scope

- Canonical PostgreSQL models for seasons, versioned progression policy, tiers, grants, wallets, claims, mutations, entitlement consumption, membership tenure, postseason brackets/matches, provider mappings, and durable legacy progression migration review.
- Normal league build projects canonical League/Team records when PostgreSQL is configured.
- Normal team claim/release projects User/TeamMember/MembershipTenure automatically. `/player progression sync-tenures` remains a repair tool rather than a required normal workflow.
- Stable guild+league+user membership identity survives team transfers. Transfers do not forfeit member-earned rewards; actual leave/kick/ban applies the configured forfeiture policy.
- Team+season initial grants remain team-owned and never re-mint merely because ownership changes.
- Legacy lifetime awards migrate idempotently when their reward meaning is unambiguous. Ambiguous awards and legacy pending attribute boosts are durably captured as `REVIEW_REQUIRED` rather than silently discarded or falsely minted.
- Commissioner cutover operation: `/player progression migrate-legacy` reconciles tenure, migrates clear legacy awards, and moves legacy pending boosts into the durable review queue before compatibility state is cleared.
- Reward overflow behavior implements `REJECT`, `BANK_LOCKED`, `CONVERT`, and `EXPIRE`, with explicit accounting and no silent point loss.
- Progression/provider evidence supports active mapped Companion Export, NeonSportz, and Custom URL connections, requires durable applied receipts, and fails closed when imported fields are missing or ambiguous.
- Dev-trait values normalize provider aliases/numeric values; age resets and attribute claims still require provider-backed before/after evidence and immutable provenance.
- Single-elimination postseason state, mapped provider final-result evidence, advancement, and policy/season scoping remain canonical.
- New PostgreSQL integration test verifies canonical projection, stable transfer membership identity, and departure forfeiture on a disposable migrated database.
- New `npm run g2:certify` production/staging gate blocks G2 enablement when duplicate active tenures, unresolved legacy migration reviews, orphan pending claims, missing season policy versions, or unmapped active supported providers remain.

## Verification completed in this artifact environment

- `node tests/contractV8G2G3.regression.test.js` -> **37 passed, 0 failed**.
- `node tests/contractV8LiveCutover.regression.test.js` -> **1 passed, 0 failed**.
- `node scripts/contract-v8-g2-g3-check.js` -> **PASS**.
- `node scripts/contract-v8-static-check.js` -> **PASS**.
- `node scripts/dependency-cycle-check.js` -> **PASS, 0 circular SCCs**.
- `node scripts/check-undefined-identifiers.js` -> **PASS**.
- `node scripts/command-contract-check.js` -> **PASS**.
- JavaScript syntax validation across `src`, `scripts`, and `tests` -> **PASS**.

## Environment certification still required before enabling G2 in production

This container intentionally has no installed `node_modules` and no live `DATABASE_URL`, Discord guild, Redis, or provider connection. Therefore it cannot honestly certify dependency-backed/full-suite or live-service behavior here.

Run in the deployment/staging checkout:

```bash
npm ci
npm run prisma:migrate:deploy
npm run tsc
npm run test:postgres
npm run contract:v8:g2g3
npm test
npm run g2:certify
npm run release:verify
npm run deploy:preflight
```

Then run the two-league Discord/provider staging acceptance sequence. Any failure there is a deployment-certification failure to repair, not missing G2 contract implementation in this handoff.
