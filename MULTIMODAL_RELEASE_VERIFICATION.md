# NOFUNBOT multimodal release verification

This package extends the league-onboarding/export-receiver build with conversational visual-media context.

Implemented media paths:
- JPEG/PNG/WebP conversational vision.
- Animated GIF frame sampling with ffmpeg.
- Short MP4/MOV/WebM/M4V frame sampling with ffmpeg.
- Discord raster stickers and Discord-proxied embed media when a supported CDN/proxy URL is available.
- Referenced/replied-to Discord media.
- Separate routing so ordinary memes do not fall into league-data OCR/import unless typed data intent is explicit.
- Member, commissioner, and IT conversational integration.
- Commissioner action boundary: visual text/context cannot authorize mutations.
- Clean-slate reset clears guild media-analysis cache.

Verification completed in the build container:
- all shipped JavaScript files passed `node --check`;
- multimodal media context regression: 9 passed, 0 failed;
- message routing regression: 7 passed, 0 failed;
- multi-party conversation regression: 10 passed, 0 failed;
- clean-slate reset regression: 11 passed, 0 failed;
- real ffmpeg decoder smoke test extracted multiple frames from generated GIF and MP4 samples.

The full clean npm/TypeScript/release gate must still be run in the user's working VS Code folder because dependency installation in the artifact container was incomplete. Do not deploy until all of these pass:

```bash
npm ci
npm test
npm run tsc
npm run release:verify
npm run deploy:preflight
```

Expected full test-file count after this addition: 33 test files.
