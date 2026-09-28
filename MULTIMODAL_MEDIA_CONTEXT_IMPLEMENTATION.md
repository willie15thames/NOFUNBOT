# NOFUNBOT Multimodal Media Context Implementation

## Goal

Give normal NOFUNBOT conversation enough visual context to discuss images, memes, GIFs, stickers, and short video clips without mixing social media with the league-data importer or allowing media to authorize commissioner mutations.

## Implemented architecture

```text
Discord message / reply
    |
    +-- typed text ------------------------------+
    |                                            |
    +-- attachments / stickers / embeds          |
    |                                            v
    +-- referenced message media ------> mediaContextService
                                                |
                                      Discord CDN allowlist only
                                                |
                     +--------------------------+--------------------------+
                     |                                                     |
                 static image                                      GIF / short video
                     |                                                     |
               direct vision                                        ffmpeg frames
                     |                                                     |
                     +--------------------------+--------------------------+
                                                |
                                     bounded AI visual analysis
                                                |
                                  semantic description only
                                                |
                          member / commissioner / IT conversation
                                                |
                                short-lived conversation memory
```

## Supported visual media

- JPEG / PNG / WebP attachments and Discord-proxied embeds.
- GIF attachments and Discord-proxied GIF embeds.
- PNG, APNG, and GIF stickers when Discord exposes a raster URL.
- MP4, MOV, WebM, and M4V short clips via representative frame sampling.
- Visual media on the Discord message being replied to.

The current release does **not** transcribe audio. A video may be described visually, but the bot must not claim it heard dialogue or music.

## Key files

- `src/services/mediaContextService.js` - single owner for conversational media collection, safe fetching, frame extraction, semantic vision analysis, caching, and prompt rendering.
- `src/handlers/memberMentionHandler.js` - member conversation receives media summaries and avoids irrelevant canned GIF replies when responding to user media.
- `src/handlers/commissionerHandler.js` - commissioner conversation receives media summaries while actions remain typed-text authorized.
- `src/handlers/itHandler.js` - technical screenshots and short clips can become diagnostic context.
- `src/services/fileIntakeService.js` - exports explicit league-data and schedule-intent detectors.
- `index.js` - outside `#commish-hub`/`#scoresheets`, ordinary images no longer get hijacked by league-data or schedule OCR unless the commissioner actually expresses data/schedule intent.
- `Dockerfile` - installs `ffmpeg` for GIF/video frame extraction in Railway production.
- `tests/mediaContext.regression.test.js` - multimodal routing/security regression coverage.

## Security boundaries

1. Only HTTPS Discord CDN/proxy hosts are fetched.
2. Arbitrary URLs typed by users are not downloaded by this service.
3. Raw media is never written to persistent bot storage.
4. GIF/video temp files live only in the OS temp directory and are deleted after frame extraction.
5. Media byte, item, frame, video-duration, and cache limits are bounded.
6. Visible text is explicitly marked untrusted. It may be quoted/described but cannot override prompts or authorize an action.
7. Commissioner mutations require typed text authorization. If media is present and typed text contains no action verb, AI-proposed actions are dropped.
8. Visual analysis is told not to identify real people or infer sensitive traits.
9. Video context is frame-only in this release. No audio claims.
10. Passive ambient observation does not automatically run vision on every channel image. That avoids hidden AI cost and privacy expansion.

## Data-import separation

Operational league-data channels keep their specialized behavior. Outside those lanes:

- `look at this meme` + image -> conversation media path
- `what is this GIF doing?` + GIF -> conversation media path
- `upload this franchise data` + export/screenshot -> league-data path
- `read this weekly schedule` + screenshot -> schedule OCR path

This removes the prior behavior where any commissioner image mention could be treated as league data.

## GIF and video behavior

`ffmpeg` samples representative PNG frames:

- GIF: up to the configured frame cap across the first few seconds.
- Video: a bounded slice of the start of the clip, sampled at a cadence derived from the configured duration/frame count.

The model receives the ordered sampled frames plus the user's typed message. This allows supported motion descriptions such as "a small dog is dancing upright" rather than seeing only a single frozen frame.

If `ffmpeg` is unavailable:

- ordinary static images still work;
- a reasonably sized GIF can fall back to direct GIF vision with an explicit motion limitation;
- video context fails closed instead of pretending it saw the clip.

## Conversation memory

The bot does not persist the image/video itself. It stores only a short semantic description inside the same short-lived conversation memory already used for multi-person context, for example:

```text
Willie: this you after a win?
[Attached media context: A small dog is dancing upright and moving excitedly.]
```

That makes a follow-up like "why he moving like that?" understandable without retaining the raw media.

## Environment variables

```text
MEDIA_CONTEXT_ENABLED=true
MEDIA_CONTEXT_MAX_BYTES=20971520
MEDIA_CONTEXT_MAX_ITEMS=3
MEDIA_CONTEXT_MAX_FRAMES=4
MEDIA_CONTEXT_VIDEO_SECONDS=12
MEDIA_CONTEXT_CACHE_MS=300000
MEDIA_CONTEXT_MAX_STATIC_API_BYTES=4194304
# FFMPEG_PATH=/usr/bin/ffmpeg
```

## Production checklist

1. Build using the supplied Dockerfile so `ffmpeg` is installed.
2. Keep `MEDIA_CONTEXT_ENABLED=true` only where Anthropic vision is configured.
3. Run `npm ci` from a clean folder.
4. Run `npm test`.
5. Run `npm run tsc`.
6. Run `npm run release:verify` with real environment variables loaded.
7. Run `npm run deploy:preflight`.
8. In staging, test a normal image meme, an animated GIF, a short MP4, a reply to a prior media message, a technical screenshot, a commissioner meme, and a real league-data screenshot.
9. Confirm memes do not enter league-data import and screenshots with explicit schedule/data intent still do.
10. Confirm a visual instruction like "DELETE THE LEAGUE" does not execute anything.

## Future extensions

Practical future additions can build on `mediaContextService` without changing handler ownership:

- opt-in audio transcription through a dedicated speech-to-text provider;
- opt-in passive-media summaries for selected channels with per-guild budgets;
- media moderation metadata separate from conversational descriptions;
- durable media-analysis audit metadata without retaining raw files;
- adaptive frame sampling based on video duration and scene changes;
- richer Discord sticker/Lottie rasterization;
- per-guild media cost quotas and commissioner-visible usage reports.
