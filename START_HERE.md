# NOFUNBOT v204.7 RC3 release candidate

<<<<<<< HEAD
Package version: 21.11.0-rc.3. Archive label: v204.7 Madden Connect + Conversation Intelligence + Structure Reset.
=======
Package version: 21.10.0-rc.7. Archive label: v204.6 wizard and wiring repairs.
>>>>>>> origin/main

Start with `docs/V204_6_WIZARD_WIRING_RC7.md` for the RC7 delta, then `docs/RC6_STABILITY_AND_DEPLOYMENT.md` for the underlying RC6 repair matrix and exact VS Code, GitHub, Railway, staging and rollback steps. RC6 repairs the thirteen RC5 fault cases. The current Word supplement is `docs/NOFUNBOT_RC6_Stability_Audit.docx`; older reports below are historical. Run `npm ci` followed by `npm run verify:local`.

RC5 preserves the member's native server name, shows team identity inside its league posts, creates readable taggable roles for new leagues and events, and prevents an active-check failure or one league's inactivity rule from harming other memberships. Read `docs/V204_COMMUNITY_IDENTITY_AND_WIRING_RC5.md` for the complete wiring record and the live checks still needed.

RC4 addresses ordinary league channel names inside their categories, stable guild nicknames, template-edit cleanup, league-scoped rules and active checks, and base permission isolation. Read `docs/V204_TEMPLATE_AND_FALLBACK_AUDIT.md` for nine confirmed failure clusters, scan counts, residual risks and staging checks.

Read `docs/V204_DATABASE_HOTFIX.md` first. RC1 referenced mixed-case PostgreSQL tables after migrations renamed them. RC2 aligns those paths and preserves legacy records through an additive migration. RC3 refuses to use a different directory when an explicitly configured BOT_DATA_DIR is unavailable.

The updated 30-page Word report is `docs/NOFUNBOT_Audit_And_Stability_Plan_Updated.docx`. It contains the original baseline findings plus the implemented changes, lifetime history behavior and outstanding stability work. Older audit documents remain as historical references.

Read `docs/V204_RELEASE_NOTES.md` for implemented capabilities, deployment steps, remaining work, staging acceptance and recovery boundaries. Read `docs/VERIFICATION.md` for exact checks and limitations. `docs/V204_FILE_MANIFEST.json` records the source-file changes against the supplied v203.2 ZIP.

This package includes source, tests, migration files and a lockfile. It contains no live database or Discord state and has not been deployed. Use a staging server and restored staging database before production. Preserve your existing database and BOT_DATA_DIR; do not replace them with this source archive. Keep one bot replica while legacy state projections remain.

Core changes include a combined three-space cap, private league/event roles, scoped team ownership and operations, ID-based erasure, and permanent lifetime member result/award/stat history. Historical records without verified member IDs require reconciliation. Detailed sports metrics need verified entry or a future provider mapper. The release candidate does not claim every recommendation or live integration gate is complete.

## v204.7 production-candidate note

The current v204.7 RC3 source implements the Madden provider connection framework, conversation intelligence, natural planner expansion, and Base/Template/Custom structure reset. Read `docs/V204_7_RELEASE_COMPLETION_REPORT.md` before deployment. Production promotion requires the clean-install full-suite/TypeScript/Prisma/release-preflight commands listed there to pass.
