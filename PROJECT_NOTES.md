# EstateTour AI — Build Notes (internal)

## Key facts
- Project path: /home/ubuntu/estatetour-ai (web-db-user template, tRPC + Drizzle + React 19 + Tailwind 4)
- Dev preview: port 3000

## Uploaded static assets (use exactly these URLs in code)
- /manus-storage/hero-living_b05098b0.jpg (modern living room)
- /manus-storage/hero-kitchen_23de8197.jpg (drone aerial YouTube thumb — actually 1280x720 aerial)
- /manus-storage/hero-aerial_18f0bf6c.jpg (aerial drone house)
- /manus-storage/hero-kitchen2_815b2217.jpg (luxury kitchen)

## Supabase Storage (server/storage.ts)
- Uploaded property photos, generated images, and finished videos are stored in a private Supabase Storage bucket.
- Required server environment variables: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`; optional `SUPABASE_STORAGE_BUCKET` defaults to `property-media`.
- Create the bucket in Supabase Dashboard → Storage before uploading. Keep it private; the server issues one-hour signed URLs for previews, AI input references, and downloads.
- Existing Forge objects are not copied automatically. Before cutover, upload any objects that must survive under the same keys—especially `hero-living_b05098b0.jpg`, `hero-kitchen2_815b2217.jpg`, `hero-aerial_18f0bf6c.jpg`, and any keys already stored in `project_images.fileKey` / `generation_jobs.videoKey`.
- The service-role key must remain server-only. Never prefix it with `VITE_` or expose it to browser code.
- Existing `/manus-storage/{key}` application URLs are retained as a compatibility proxy to Supabase signed URLs.

## AI generation deployment
- Required server secrets: `INWORLD_API_KEY` (the Base64 credential copied from Inworld) and `OPENROUTER_API_KEY` (an OpenRouter key, normally starting with `sk-or-`). Never expose either key through a `VITE_` variable.
- Optional model overrides: `INWORLD_VISION_MODEL` defaults to `anthropic/claude-sonnet-4-6`; `OPENROUTER_VIDEO_MODEL` defaults to `kwaivgi/kling-v3.0-pro`. Leave these unset to use the reviewed defaults.
- Inworld analysis: POST `https://api.inworld.ai/v1/chat/completions` with Basic authentication. Every signed image URL is sent in sequence order in one multimodal request. Claude returns the per-photo plan, optimized combined prompt, and an AI-selected duration clamped to 4–15 seconds.
- OpenRouter generation: POST `https://openrouter.ai/api/v1/videos` with Bearer authentication, Kling 3.0 Pro, `resolution: "1080p"`, `generate_audio: false`, and ordered `input_references`. Supported Kling ratios exposed by the app are `16:9`, `9:16`, and `1:1`.
- Poll: GET `/api/v1/videos/{jobId}` until completed/failed/cancelled/expired. Completed output is downloaded from `unsigned_urls[0]` or `/content?index=0`, archived to private Supabase Storage, and returned through a signed URL.
- Provider configuration is checked before a paid job is created. Transient Inworld request/response failures use the preservation-focused fallback prompt; missing credentials do not silently bypass analysis.
- The model is strongly instructed to preserve rooms, furniture, materials, textures, composition, and image order. Generative video cannot guarantee pixel-identical frames, so the UI does not promise impossible lossless output.
- `OPENROUTER_LIVE_TEST=1` is test-only and opts into a lightweight live credential check; do not set it for normal runtime.

## Complete production variables
- Core: `DATABASE_URL`, `JWT_SECRET`; `VITE_APP_ID` is optional and defaults to `estatetour-ai`.
- Storage: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`; optional `SUPABASE_STORAGE_BUCKET` defaults to `property-media`.
- AI: `INWORLD_API_KEY`, `OPENROUTER_API_KEY`; optional model overrides are listed above.
- Billing/auth variables remain required only for the corresponding Stripe/OAuth deployment paths.

## Design system (client/src/index.css)
- Soft pink palette: bg #FFF6F9, blush #F7B8D0, rose #E894B5 (primary), charcoal #3A2E33
- Fonts: Sora (display/headings), Inter (body) — loaded in index.html
- Utilities: .glass-panel, .pink-glow, .soft-card-hover, .btn-springy, .animate-blob-1/2/3, .animate-fade-up(-delay-1/2/3), .animate-glow-pulse, .animate-border-breathe, .animate-shimmer, .animate-ken-burns, .reveal-on-scroll (+ .is-visible)

## Backend done
- drizzle/schema.ts: projects, project_images (sequenceIndex strict), generation_jobs (status: processing/ready/failed exactly), subscriptions (plan: starter/pro/annual/business); migration applied
- `server/db.ts` atomically reserves plan usage under a per-user Postgres advisory lock: exact v2 prices receive 36 included generations per exact Stripe yearly period or 3 per exact monthly period. Exact known v1 prices retain their sold access; unknown or malformed prices fail closed. Failed included jobs stop consuming allowance; each paid $15 add-on Checkout Session is permanently attached to one at-most-once job and never automatically resubmitted after an ambiguous provider failure.
- server/routers/tour.ts: getState, updateSettings, uploadImage (base64, server-assigned seq idx, Supabase Storage key user-{id}/project-{id}/seq-NNN.ext), reorderImages, deleteImage, updateRoomTag, generate (subscription-gated, hidden prompt optimization, fallback prompt), pollJob (downloads video to Supabase Storage on complete), listJobs, getDownloadUrl (sub-gated)
- `toClientJob` strips `optimizedPrompt`, `openrouterJobId`, `videoKey`, and internal `imageSequence`/Checkout Session data from responses; it exposes only a safe `additionalVideo` flag so failed paid jobs show support/refund guidance instead of an unsafe Retry action.
- `shared/plans.ts`: customer checkout offers Yearly first ($29/year, 36 videos/year) and Monthly ($39/month, 3 videos/month); both list 10 images/video, 1080p, all supported ratios, viral effects, $15 additional videos, priority queue, no watermark, and high-quality cinematic output. `MAX_IMAGES=10`.

## Frontend generation flow
- `client/src/hooks/useToolDraft.ts`: lightweight settings in localStorage and high-quality image payloads in IndexedDB; legacy unsupported ratios normalize to 16:9.
- `client/src/lib/imageUpload.ts`: files at or below 10 MiB are uploaded byte-for-byte; larger photos are resized/re-encoded only enough to fit the server limit.
- `client/src/components/TourTool.tsx`: numbered Image 1…N timeline with drag/arrow reordering and only Kling-supported aspect ratios, each with an icon and destination hint. AI chooses camera style and duration.
- `client/src/pages/Dashboard.tsx`: uploads one-by-one in user order, starts authenticated generation, polls active jobs every five seconds, and displays signed Supabase video URLs.

## Current verification notes
- Changed AI/provider modules transpile successfully with Bun, and mocked Inworld/OpenRouter contract checks verify endpoint, auth, model, strict image ordering, 1080p, no audio, aspect ratio, and duration handling.
- `git diff --check` passes and the blocker-level semantic review is approved.
- Full Vitest/typecheck execution requires installed project dependencies. The sandbox used for this audit has no `node_modules` and cannot download packages through its restricted network.
- Live provider authentication/model access still must be verified after setting the production secrets; mocked checks do not spend provider credits.

## Remaining
- Home.tsx (in progress — full cinematic landing w/ hero blobs, parallax, features, how-it-works, embedded TourTool, sign-up gate via startLogin from @/const)
- Dashboard paywall: non-subscriber generation animation completes once, stays on the locked blurred preview, then opens the two-plan pricing popup; callback re-renders cannot restart it and real video playback remains subscription-gated.
- Stripe: webdev_add_feature feature="stripe" (not yet run)
- App.tsx routes: / (Home), /dashboard
- Stripe creates and validates exact versioned recurring prices for Yearly/Monthly plus a one-time USD $15 additional-video checkout. Redemption verifies the paid total, currency, line item, signed-in user, and a recognized active recurring plan. The browser persists the Checkout Session and associated job until completion; the server permanently returns that same job after refresh or a lost response and never resubmits one payment after an ambiguous provider failure.
- Current pricing: Yearly $29/year (36 videos) is first/default; Monthly $39/month includes 3 videos. Both advertise the same 1080p cinematic feature set and $15 additional videos.
