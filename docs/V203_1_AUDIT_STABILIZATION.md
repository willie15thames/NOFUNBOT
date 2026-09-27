# V203.1 Audit Stabilization Applied

This package is a regression-safe stabilization pass based on the fresh v203 full codebase audit. It is not a feature rewrite.

## What is fixed now

1. **League setup undefined helpers**: `leagueChannelName()` and `leaguePrefixCode()` are restored in `src/services/leagueNamingService.js` and imported by setup. It preserves the documented v18 `<2-char-prefix>.<channel-key>` contract so existing multi-league discovery does not regress.
2. **Active-check naming compatibility**: active-check provisioning now calls the same canonical v18 naming service used by setup, so discovery and creation cannot drift into separate naming formulas.
3. **Production env safety**: `src/config/runtimeValidation.js` is shared by boot/deploy/infra checks and rejects production localhost DB/Redis URLs plus known placeholder secrets.
4. **Prisma health truth**: client construction, network reachability and schema readiness are distinct. Diagnostics use a real query and expose circuit/failure state.
5. **Health severity**: `/health-status` distinguishes blocking readiness failures from non-blocking warnings. Optional AI degradation no longer means the core bot is automatically unready.
6. **Database circuit breaker**: repeated connectivity failures pause ordinary retries briefly instead of flooding logs.
7. **Queue worker lifecycle**: required configuration and connectivity are checked before readiness. Shutdown is explicit. The contradictory unref'd keepalive retry was removed.
8. **Railway boot semantics**: requested DB migration/bootstrap steps are fail-closed. They cannot fail silently while the app continues as if persistence were ready.
9. **Timer authority**: once a new automation policy exists, the advance engine owns the deadline. The legacy weekly repost timer is not armed as a competing clock.
10. **AI placeholder protection**: a placeholder Anthropic key is configuration-invalid and no call is attempted as if AI were ready.
11. **Command reachability**: bot lifecycle and guide publication handlers have registered grouped compatibility paths without adding top-level command visibility.
12. **Command contract CI**: command definitions and router cases are checked against an explicit legacy/internal allowlist.
13. **Undefined identifier CI**: an executable unresolved identifier check is part of release verification.
14. **Changelog guard**: validates the actual package version instead of a stale hard-coded historical release tag.
15. **Additional unresolved runtime references found during stabilization**: `LEAGUE_RULE_PRESETS` is now imported from `src/config/rules.js`, and the `initialize-server` handler defines its long-interaction `ackMode` before the recent-reboot path can use it.
16. **Static guard hardened**: the unresolved-identifier check ignores genuine Node runtime globals when `@types/node` is unavailable, while still failing on project-level executable identifiers.

## Intentionally not bundled into this patch

The audit also recommends larger changes that are deliberately deferred because they are higher-regression migrations:

- splitting the 4,800+ line interaction router,
- wholesale replacement of every best-effort/null catch,
- final JSON-to-PostgreSQL read-authority cutover,
- changing existing public top-level command names,
- inventing an unsupported EA/Madden control capability.

These should be performed only after characterization tests and a stable trial build.

## Required verification before deploy

```bash
npm install
npm run prisma:generate
npm run release:verify
npm run deploy:preflight
```

Then deploy to a non-production/test guild first and verify:

- Standard Madden setup completes and can be rerun without duplicate channels.
- Fantasy Draft setup completes and can be rerun without duplicate channels.
- `/health-status`, `/diagnose`, and `/audit-wiring` remain reachable.
- PostgreSQL and Redis report real connectivity, not merely configured URLs.
- `/workflow bot status` works and lifecycle aliases retain commissioner permissions.
- advance automation remains shadow/blocked until explicitly enabled and provider readiness is verified.
