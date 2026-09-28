# NOFUNBOT v204.7

NOFUNBOT is a Discord league-operations bot for Madden-style franchise communities. v204.7 adds a league-scoped provider connection framework, passive conversation awareness with explicit-mention speech gating, a broader deterministic natural-language planner, and a simplified three-mode server-structure model.

## Quick start

```bash
npm ci
npm run prisma:generate
npm run prisma:migrate:deploy
npm test
npm run tsc
npm run release:verify
npm run deploy:preflight
npm start
```

Production deployments should use PostgreSQL and Redis, a persistent `BOT_DATA_DIR`, and `NODE_ENV=production`. Do not deploy with placeholder secrets.

## Server structure modes

v204.7 has exactly three structure modes:

- **Base Structure**: core NOFUNBOT/server lanes only. No template and no subtemplate is selected or silently defaulted.
- **Template Structure**: one curated template plus a relevant built-in subtemplate when that family uses one.
- **Custom Structure**: commissioner-selected templates and optional subtemplates are composed and deduplicated before creation.

The legacy **Empty** structure choice is removed. Base is the empty/template-free starting point.

A lightweight **General / Simple Server** template family is included for commissioners who do not want the more complex league layouts. Built-in simple subtemplates include Community Chat, Gaming, Sports, Study Group, and Watch Party.

## Conversation intelligence

The bot may retain a short-lived, in-memory context window for permitted guild text channels so a later explicit mention can understand what the room has been discussing.

Passive observation:

- makes no AI call;
- sends no typing indicator, reaction, or reply;
- performs no state mutation;
- does not persist message bodies to PostgreSQL, Redis, JSON, or analytics;
- is channel-local and bounded by TTL/message limits;
- excludes DMs, bots/webhooks, and configured sensitive staff/ops lanes.

Conversational speech still requires an explicit `@myBot` mention. Replying to an old bot message, being in a special channel, or merely continuing the conversation does not authorize the bot to speak.

Example:

```text
Paul: Ravens defense is ridiculous this year.
Sam: Their secondary is carrying them.
@myBot who do you think is the key player?
```

Only the final message invokes AI. The earlier messages are untrusted context, not instructions.


## Multimodal media context

Normal bot conversation can interpret supported Discord-hosted visual media when the bot is explicitly engaged. The media path is separate from the league-data screenshot importer so a meme is not accidentally treated as Madden standings.

Supported conversational media:

- JPEG, PNG, and WebP images and memes;
- animated GIF attachments and Discord-proxied GIF embeds;
- PNG/APNG/GIF stickers when Discord exposes a raster media URL;
- short MP4, MOV, WebM, and M4V clips through representative frame sampling;
- media on the message being replied to, when Discord still exposes that referenced message.

Behavior and safety:

- Raw media is fetched only from approved Discord CDN/proxy hosts and is not persisted.
- Animated GIFs and videos are sampled into bounded image frames with `ffmpeg`; the Railway Docker image installs `ffmpeg`.
- Only a concise semantic description enters short-lived conversation memory so later turns can understand what was posted without storing the media itself.
- Text visible inside media is treated as untrusted content to describe, never as bot instructions.
- Commissioner actions still require typed text authorization. Visual content alone cannot authorize a warning, ban, reset, deletion, or other mutation.
- The bot does not identify real people from visual media or infer sensitive personal traits.
- Video support is visual-frame context only. Audio is not transcribed, so the bot must not claim to know spoken dialogue unless the text conversation provides it.
- Passive channel observation does not run vision on every image by default. This avoids surprise AI cost/privacy impact. Media is analyzed when the bot is engaged on that message or a reply referencing it.

Production tuning variables are documented in `.env.example`; the primary switch is `MEDIA_CONTEXT_ENABLED=true`.

## Natural-language actions

The deterministic planner is an adapter into existing domain services. It does not own duplicate league state.

Examples:

```text
@myBot put Paul on the Ravens
@myBot release the Ravens
@myBot show league status
@myBot refresh open teams
@myBot sync league data now
@myBot test the NeonSportz connection
@myBot put the provider in manual fallback
```

Entity resolution asks a clarification only when there is a real ambiguity. If one active league contains the requested Ravens team, that league is selected. If more than one valid Ravens team exists, the bot asks which league rather than guessing.

Destructive or privileged actions still pass through the registered action catalog, permission checks, confirmation rules, and the existing domain service.

## Madden data providers

v204.7 supports the connection framework for:

- Madden Companion Direct
- NeonSportz
- Custom HTTPS/JSON endpoint
- Manual/local fallback

Direct EA control remains feature-gated/unsupported until a legitimate, authorized Madden interface exists. The bot must not collect EA passwords, replay private browser sessions, or depend on undocumented control endpoints.

Provider state is league-scoped. Secrets are encrypted at rest, receiver tokens are stored as hashes, sync/import runs are durable, and accepted push imports are made durable before a 2xx acknowledgement.

### Important production variables

At minimum review:

```text
DATABASE_URL
REDIS_URL
BOT_DATA_DIR
PUBLIC_BASE_URL
ENABLE_PROVIDER_HTTP=true
PROVIDER_HTTP_PORT=3100
PROVIDER_SECRET_KEY=<32+ byte random secret>
BOT_AMBIENT_CONTEXT_MINUTES=30
BOT_AMBIENT_CONTEXT_MAX_MESSAGES=32
ENABLE_TRASH_TALK_LEARNING=false
```

Legacy Companion/Neon environment variables remain compatibility paths only. New production connections should be created through the league-scoped provider connection framework.

## Release verification

Before production promotion, run from a clean checkout/install:

```bash
npm ci
npm run prisma:generate
npm run prisma:migrate:deploy
npm test
npm run tsc
npm run release:verify
npm run deploy:preflight
```

Also exercise a staging Discord guild for setup/edit mode, mention routing, natural assignment, trade proposal/decision, game-channel lifecycle, streams, startup recovery, and provider fault cases.

## Key documentation

- `AI_READ_FIRST.txt` - mandatory engineering contract
- `START_HERE.md` - project entry point
- `CODEBASE_NAVIGATION.md` - ownership and navigation map
- `DEDUP_ARCHITECTURE.md` - single-owner/dedup rules
- `docs/NOFUNBOT_v204.7_Madden_Connect_Implementation_Spec.docx`
- `docs/NOFUNBOT_v204.7_Full_Regression_Implementation_Audit.docx`
- `docs/V204_7_RELEASE_COMPLETION_REPORT.md`

## Security note

Never commit `.env`, provider secrets, receiver tokens, Discord tokens, EA credentials, or production database URLs. Use Railway/host secret variables and rotate any credential that has been exposed.
