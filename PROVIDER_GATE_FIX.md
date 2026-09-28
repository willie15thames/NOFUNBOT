# Provider Gate Fix

This follow-up fixes the two remaining failures reported by `providersIngestion.test.js` after the clean-slate/multi-party patch.

## Fixed

1. **Companion gateway wrong-token behavior**
   - When `COMPANION_EXPORT_TOKEN` is configured but the supplied token is wrong, the gateway now reports `404 not-found` instead of incorrectly treating the receiver as unconfigured and returning `503`.
   - This preserves the security contract that invalid tokens do not reveal token validity.

2. **NeonSportz missing-config contract**
   - `healthCheck()` now reports the missing configuration as separate canonical keys:
     - `NEONSPORTZ_SNAPSHOT_URL`
     - `NEONSPORTZ_RESOURCE_URLS_JSON`
   - This restores compatibility with the regression test and gives operators machine-readable missing settings.

## Verification performed in patch workspace

- `node --check src/providers/madden/companion/exportGateway.js` PASS
- `node --check src/providers/madden/neonsportz/client.js` PASS
- Direct Companion gateway assertion: wrong configured token -> HTTP 404 PASS
- Direct NeonSportz health assertion: canonical missing keys returned PASS

A full `npm test` was not re-run in the patch workspace because the package install did not complete there. The user's local run already demonstrated that every other suite passed and isolated these two provider-ingestion assertions.

## Run locally

```bash
rm -rf node_modules
npm ci
npm test
npm run tsc
```

Then run release/deployment gates with your normal Railway/local environment variables loaded:

```bash
npm run release:verify
npm run deploy:preflight
```

`release:verify` and `deploy:preflight` intentionally fail when required production variables such as `DISCORD_TOKEN`, `CLIENT_ID`, `GUILD_ID`, database/Redis settings, or the AI key are not present in the current shell/environment.
