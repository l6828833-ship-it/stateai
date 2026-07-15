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
- Required server secrets: `INWORLD_API_KEY` (the Base64 credential copied from Inworld) and `KLING_API_KEY` (the Bearer API key issued by Kling AI). Never expose either key through a `VITE_` variable.
- Optional configuration: `INWORLD_VISION_MODEL` defaults to `anthropic/claude-sonnet-4-6`; `KLING_API_BASE_URL` defaults to the official Singapore endpoint, `https://api-singapore.klingai.com`. There is no video model override: the endpoint itself is fixed to Kling 3.0 at `/image-to-video/kling-3.0`.
- Inworld analysis: POST `https://api.inworld.ai/v1/chat/completions` with Basic authentication. Every signed image URL is sent in sequence order in one multimodal request. Claude returns the per-photo plan, optimized combined prompt, and an AI-selected duration clamped to 4–15 seconds.
- Official Kling submission: POST `/image-to-video/kling-3.0` with Bearer authentication. The request uses the documented `contents`, `settings`, and `options` structure: prompt plus required `first_frame` and optional `last_frame`; 1080p; 3–15-second duration; audio off; multi-shot off; and watermark disabled. Kling's documented Image-to-Video request does not expose an aspect-ratio field, so the chosen composition is included in the prompt and the first frame determines the source canvas.
- Each task uses the globally unique `external_task_id` `estatetour-generation-{databaseJobId}`. The submission POST is never automatically retried. If its response is lost, the server queries by external ID and recovers the accepted task. If it still cannot be found, the job is left `processing` (never failed) so later polls reconcile it by external ID — this prevents a duplicate paid generation and prevents a second submission from an included-plan retry.
- Poll: GET `/tasks?task_ids={id}` until `succeeded` or `failed`. A successful output URL is downloaded immediately and archived to private Supabase Storage because Kling clears generated outputs after 30 days. The application continues polling rather than using `callback_url`, so no unauthenticated callback route is exposed.
- All photos still influence the Inworld property analysis and final prompt. The official Image-to-Video endpoint receives only the documented first/last frame references; arbitrary OpenRouter-style `input_references` are not sent.
- Provider configuration is checked before a paid job is reserved. Transient Inworld request/response failures use the preservation-focused fallback prompt; missing credentials do not silently bypass analysis.
- `OPENROUTER_API_KEY` is no longer used for new generations. It is optional only while unprefixed legacy OpenRouter processing jobs remain; remove it after those jobs finish. New official Kling task IDs are stored with a `kling:` prefix in the existing physical `openrouterJobId` database column for zero-downtime compatibility.
- `KLING_LIVE_TEST=1` is test-only and opts into a no-generation credential query; do not set it for normal runtime.

## Complete production variables
- Core: `DATABASE_URL`, `JWT_SECRET`; `VITE_APP_ID` is optional and defaults to `estatetour-ai`.
- Storage: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`; optional `SUPABASE_STORAGE_BUCKET` defaults to `property-media`.
- AI: required `INWORLD_API_KEY`, `KLING_API_KEY`; optional `INWORLD_VISION_MODEL`, `KLING_API_BASE_URL`; temporary optional `OPENROUTER_API_KEY` only for draining legacy processing jobs.
- Billing/auth variables remain required only for the corresponding Stripe/OAuth deployment paths.

## Design system (client/src/index.css)
- Soft pink palette: bg #FFF6F9, blush #F7B8D0, rose #E894B5 (primary), charcoal #3A2E33
- Fonts: Sora (display/headings), Inter (body) — loaded in index.html
- Utilities: .glass-panel, .pink-glow, .soft-card-hover, .btn-springy, .animate-blob-1/2/3, .animate-fade-up(-delay-1/2/3), .animate-glow-pulse, .animate-border-breathe, .animate-shimmer, .animate-ken-burns, .reveal-on-scroll (+ .is-visible)

## Backend done
- drizzle/schema.ts: projects, project_images (sequenceIndex strict), generation_jobs (status: processing/ready/failed exactly), subscriptions (plan: starter/pro/annual/business); migration applied
- `server/db.ts` atomically reserves plan usage under a per-user Postgres advisory lock: exact v2 prices receive 36 included generations per exact Stripe yearly period or 3 per exact monthly period. Exact known v1 prices retain their sold access; unknown or malformed prices fail closed. Failed included jobs stop consuming allowance; each paid $15 add-on Checkout Session is permanently attached to one at-most-once job and never automatically resubmitted after an ambiguous provider failure.
- server/routers/tour.ts: getState, updateSettings, uploadImage (base64, server-assigned seq idx, Supabase Storage key user-{id}/project-{id}/seq-NNN.ext), reorderImages, deleteImage, updateRoomTag, generate (subscription-gated, hidden prompt optimization, fallback prompt), pollJob (downloads video to Supabase Storage on complete), listJobs, getDownloadUrl (sub-gated)
- `toClientJob` strips `optimizedPrompt`, generic `providerTaskId`, `videoKey`, and internal `imageSequence`/Checkout Session data from responses; it exposes only a safe `additionalVideo` flag so failed paid jobs show support/refund guidance instead of an unsafe Retry action.
- `shared/plans.ts`: customer checkout offers Yearly first ($29/year, 36 videos/year) and Monthly ($39/month, 3 videos/month); both list 10 images/video, 1080p, all supported ratios, viral effects, $15 additional videos, priority queue, no watermark, and high-quality cinematic output. `MAX_IMAGES=10`.

## Frontend generation flow
- `client/src/hooks/useToolDraft.ts`: lightweight settings in localStorage and high-quality image payloads in IndexedDB; legacy unsupported ratios normalize to 16:9.
- `client/src/lib/imageUpload.ts`: files at or below 10 MiB are uploaded byte-for-byte; larger photos are resized/re-encoded only enough to fit the server limit.
- `client/src/components/TourTool.tsx`: numbered Image 1…N timeline with drag/arrow reordering and only Kling-supported aspect ratios, each with an icon and destination hint. AI chooses camera style and duration.
- `client/src/pages/Dashboard.tsx`: uploads one-by-one in user order, starts authenticated generation, polls active jobs every five seconds, and displays signed Supabase video URLs.

## Current verification notes
- The official Kling request builder has contract coverage for first/last frames, 1080p, audio off, multi-shot off, no watermark, duration validation, external task IDs, and legacy-vs-official stored task IDs.
- Changed AI/provider modules transpile successfully with Bun; `git diff --check` passes.
- Full Vitest/typecheck execution requires installed project dependencies. If unavailable in the sandbox, deployment CI must run them before merge.
- Live Kling authentication and account access still require `KLING_API_KEY`; unit checks do not submit media or spend provider credits.

## Remaining
- Home.tsx (in progress — full cinematic landing w/ hero blobs, parallax, features, how-it-works, embedded TourTool, sign-up gate via startLogin from @/const)
- Dashboard paywall: non-subscriber generation animation completes once, stays on the locked blurred preview, then opens the two-plan pricing popup; callback re-renders cannot restart it and real video playback remains subscription-gated.
- Stripe: webdev_add_feature feature="stripe" (not yet run)
- App.tsx routes: / (Home), /dashboard
- Stripe creates and validates exact versioned recurring prices for Yearly/Monthly plus a one-time USD $15 additional-video checkout. Redemption verifies the paid total, currency, line item, signed-in user, and a recognized active recurring plan. The browser persists the Checkout Session and associated job until completion; the server permanently returns that same job after refresh or a lost response and never resubmits one payment after an ambiguous provider failure.
- Current pricing: Yearly $29/year (36 videos) is first/default; Monthly $39/month includes 3 videos. Both advertise the same 1080p cinematic feature set and $15 additional videos.
