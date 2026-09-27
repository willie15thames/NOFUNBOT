# Community identity and connection audit RC5

Reviewed 27 September 2026 against source package 21.10.0-rc.5 and the supplied active-check screenshot. This document supplements the 30-page Word report and `V204_TEMPLATE_AND_FALLBACK_AUDIT.md`. It distinguishes confirmed source behavior from the live tests still needed.

## Discord identity boundary

A Discord member has one nickname per server. Categories and channels cannot assign different native nicknames to the same user in the same server. Changing the nickname on each message would flip the name for everyone and every channel, including the commissioner. RC5 stops automatic team and timezone nickname assignment. A custom server nickname is left alone. When an existing nickname exactly matches a known legacy bot team plus timezone pattern, the bot clears its own old nickname so Discord displays the person's profile name. The bot reports `not-manageable` when its role cannot change that legacy nickname; server owners and members with roles above the bot require a human admin to clear it. Existing arbitrary nicknames are not guessed at or reset.

League identity is stored by league ID and shown in league-specific bot posts, including active-check member labels. Each new league and event receives its own human-readable, mentionable member role with no server-wide permissions. The role's category overwrites grant access; its name contains the competition name and a short stable ID. A bot active check pings only its league role, and a newly opened team pings that league role. A stat-leader post pings the selected league role when there is a selected league; no global `@everyone` fallback is used. Native per-community names would require separate Discord servers, not categories in one server.

## Confirmed connection faults corrected

| Connection | Previously observed or traced fault | RC5 behavior |
| --- | --- | --- |
| Team claim to nickname | Claim and message activity assigned team/timezone guild nicknames, which could conflict across leagues. | Team identity remains scoped data; no new nickname is assigned. Legacy bot team nicknames are restored when identifiable. |
| Commissioner identity to role hierarchy | A higher commissioner or owner role may prevent nickname edits; callers often discarded the result. | No routine commissioner rename is attempted. A failed legacy restore yields an explicit `not-manageable` result and a manual admin action. |
| League or event creation to membership role | Roles existed, but opaque names were difficult to tag. | Readable unique role names; mentionable for role tags; no server-wide permissions. Existing opaque roles remain until an explicit migration. |
| Active-check post to response timer | A rejected Discord send was swallowed, yet the 48-hour response timer started. | Send failure propagates; no response timer starts until the post succeeds. |
| Active-check to member identity | A global member nickname could show a team from another league. | The active-check post lists the selected league's team beside each member and tags the selected league role. |
| Inactivity removal to access | At five misses the bot kicked a member from the whole server, destroying access to other leagues and events. | Release only the selected league's team and role; the member stays in the server and retains other memberships. The ledger release targets that league. |
| Community role to privacy | Role creation, permission edits and member role changes could fail silently while selection returned success. A pending league could be processed as a community channel. | Role/permission failures propagate, member roles roll back on failure, the profile is saved after success, and pending private category IDs are excluded from community permission edits. |
| Team/leader announcements to notification | League announcements used global `@everyone`. | A selected league role is tagged; missing role/context never falls back to `@everyone`. |

## Tests and limitations

| Layer | Local evidence | What it does not establish |
| --- | --- | --- |
| Module graph | TypeScript AST resolved 1,041 literal relative `require` edges in 195 JavaScript files; zero unresolved. | Dynamic module paths and runtime API responses. |
| Commands | Command contract check passed: 116 definitions, 129 router cases, 13 classified legacy/internal cases. | Registration in the live Discord application or every permission branch. |
| Runtime logic | `npm run release:verify` runs doctor, undefined-identifier guard, command contract and all local tests; `npm run tsc` and all shipped JavaScript syntax checks pass. Focused checks cover role options, nickname preservation/restoration, failed active-check posting, role tagging, league-only inactivity, private pending spaces and community role failure. | Real Discord role hierarchy, rate limits, effective member permissions, networked PostgreSQL, Redis worker, provider and Railway deploy. |
| Database | Existing migration/PGlite and local critical-store checks are retained from RC2–RC4. | A live database migration or a restored production backup test in this turn. |

Do not invoke destructive reset, live posting, migrations, league creation or provider actions merely to count test coverage. They require staging credentials and a disposable server/database. The source release has not touched production. Stage with three mixed spaces, members in overlapping communities, a high-role commissioner and a member with a custom nickname. Confirm the bot's role can manage its own membership roles, old legacy nicknames are restored only when identifiable, each role ping reaches only its competition, and losing one league does not erase lifetime records or other access.

## Remaining work

The earlier fallback inventory remains open. In particular, initial full reset has broader channel deletion than template edit; legacy overwrites require effective-permission reconciliation; Discord create followed by a failed state write can leave partial assets; and many optional catch handlers remain unclassified. Active-check send followed by failed state persistence can duplicate a post on retry; add a durable message ID journal before treating that path as exactly once. Existing opaque roles should be renamed by recorded ID in a separate reviewed migration, not guessed by name. Community selector and guide-post failures outside the traced core paths need focused triage. A live end-to-end pass must capture the actual deployed SHA, role hierarchy, permissions, database schema readiness, volume persistence and backup restore.
