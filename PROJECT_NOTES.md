# EstateTour AI — Build Notes (internal)

## Key facts
- Project path: /home/ubuntu/estatetour-ai (web-db-user template, tRPC + Drizzle + React 19 + Tailwind 4)
- Dev preview: port 3000

## Uploaded static assets (use exactly these URLs in code)
- /manus-storage/hero-living_b05098b0.jpg (modern living room)
- /manus-storage/hero-kitchen_23de8197.jpg (drone aerial YouTube thumb — actually 1280x720 aerial)
- /manus-storage/hero-aerial_18f0bf6c.jpg (aerial drone house)
- /manus-storage/hero-kitchen2_815b2217.jpg (luxury kitchen)

## OpenRouter integration (server/openrouter.ts)
- Video: POST https://openrouter.ai/api/v1/videos with model "bytedance/seedance-2.0", fields: prompt, duration, resolution, aspect_ratio, generate_audio, input_references:[{type:"image_url",image_url:{url}}]
- Poll: GET /api/v1/videos/{jobId} → status: pending/processing/completed/failed/cancelled/expired; unsigned_urls[0] = video
- Download: GET /api/v1/videos/{jobId}/content?index=0 (Bearer auth)
- Prompt optimizer: anthropic/claude-sonnet-4.5 via /chat/completions multimodal (all images one call), returns JSON {sequence:[...], optimized_prompt}
- Seedance 2.0 pricing: from $0.06726/second
- IMPORTANT: sandbox egress IP is blocked by OpenRouter Cloudflare (403 "Access denied by security policy" on ALL endpoints incl. unauthenticated). Production likely fine. Live test gated behind OPENROUTER_LIVE_TEST=1 env in server/openrouter.test.ts
- OPENROUTER_API_KEY is set in env (sk-or-v1-..., 73 chars)

## Design system (client/src/index.css)
- Soft pink palette: bg #FFF6F9, blush #F7B8D0, rose #E894B5 (primary), charcoal #3A2E33
- Fonts: Sora (display/headings), Inter (body) — loaded in index.html
- Utilities: .glass-panel, .pink-glow, .soft-card-hover, .btn-springy, .animate-blob-1/2/3, .animate-fade-up(-delay-1/2/3), .animate-glow-pulse, .animate-border-breathe, .animate-shimmer, .animate-ken-burns, .reveal-on-scroll (+ .is-visible)

## Backend done
- drizzle/schema.ts: projects, project_images (sequenceIndex strict), generation_jobs (status: processing/ready/failed exactly), subscriptions (plan: starter/pro/annual/business); migration applied
- server/db.ts: full helpers incl. reorderProjectImages (validates exact id set, two-phase update), hasActiveSubscription
- server/routers/tour.ts: getState, updateSettings, uploadImage (base64, server-assigned seq idx, S3 key user-{id}/project-{id}/seq-NNN.ext), reorderImages, deleteImage, updateRoomTag, generate (subscription-gated, hidden prompt optimization, fallback prompt), pollJob (downloads video to S3 on complete), listJobs, getDownloadUrl (sub-gated)
- toClientJob strips optimizedPrompt + openrouterJobId from all client responses
- shared/plans.ts: PLANS array (starter $9/mo, annual $29/yr, pro $39/mo highlighted, business $99/mo), TOUR_STYLES exactly ["Walkthrough","Drone","Cinematic"], RESOLUTIONS, ASPECT_RATIOS, DURATIONS, MAX_IMAGES=20

## Frontend done so far
- client/src/hooks/useToolDraft.ts: localStorage guest draft (images as dataURLs downscaled 1600px, settings, pendingGenerate flag), fileToDataUrl helper
- client/src/components/TourTool.tsx: shared tool (upload zone w/ breathing border, drag-reorder timeline w/ numbered pills + arrows, style selector 3 cards, creative textarea, res/aspect/duration selects, glowing Generate button)

## Test status (Phase 6, in progress)
- All 15 vitest tests pass (billing: Stripe live auth + price creation OK; tour: styles/status labels/hidden fields/ordering guard OK)
- Homepage verified: upload 3 test photos (/home/ubuntu/test-photos/room*.jpg) works, reorder timeline renders, Generate → redirects to Manus OAuth sign-in (gate works)
- Dashboard renders (Welcome back Slim, tool + Output + Your videos)
- Stripe billing endpoints: /api/billing/checkout (auth-gated 401 OK), /api/stripe/webhook registered w/ raw body
- Browser test halted at Manus login page (sandbox browser can't complete owner OAuth) — dashboard fake-gen flow verified earlier via screenshot session where user was auto-logged
- Remaining to verify: fake generation animation → blurred preview → pricing popup (need logged-in preview session); then checkpoint + deliver

## Remaining
- Home.tsx (in progress — full cinematic landing w/ hero blobs, parallax, features, how-it-works, embedded TourTool, sign-up gate via startLogin from @/const)
- Dashboard page: mirrors tool, syncs draft→server after login, fake generation animation for non-subscribers → blurred video + pricing popup (4 plans), real generation for subscribers, job history (processing/ready/failed), billing portal
- Stripe: webdev_add_feature feature="stripe" (not yet run)
- App.tsx routes: / (Home), /dashboard
- Stripe plan wiring uses shared/plans.ts
- User asked: $29/yr annual "early bird", 4 plans total; fake gen animation THEN blurred preview THEN pricing popup over it
