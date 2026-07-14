# EstateTour AI — Project TODO

## Backend & Data
- [x] Drizzle schema: projects, projectImages (with sequenceIndex), generationJobs, subscriptions tables
- [x] DB migration generated and applied
- [x] S3 upload pipeline: presigned/direct upload with strict sequenceIndex metadata per image
- [x] tRPC procedures: project create/get/update, image upload/reorder/delete, settings persistence
- [x] OpenRouter integration module (server-side only, hidden from user)
- [x] LLM prompt optimizer: send all images in one multimodal call, get structured JSON per photo (room_type, camera_move, seedance_prompt) — fully invisible to user
- [x] Video generation via OpenRouter bytedance/seedance-2.0, only for active subscribers
- [x] Generation job tracking with status polling (statuses exactly: processing, ready, failed)
- [x] OPENROUTER_API_KEY secret requested via secrets flow

## Homepage (public)
- [x] Cinematic soft-pink design system (palette #FFF6F9 / #F7B8D0 / #E894B5 / #3A2E33) in index.css + Google fonts
- [x] Hero: full-viewport, drifting gradient blobs, fade+slide-up headline, glass panel preview card, glowing pill CTA, cursor parallax
- [x] Creative marketing copy throughout
- [x] Feature section: 3 glass cards with staggered scroll reveal (150ms), line icons
- [x] How It Works: horizontal animated timeline (upload → confirm order → generate → review → export) with scroll glow
- [x] Footer: minimal, pink hairline divider
- [x] Homepage upload tool: drag & drop images, drag-to-reorder with numbered pill badges, tour style selector (exactly: Walkthrough, Drone, Cinematic), generation settings, creative prompt/style text input
- [x] Sign-up gate: unauthenticated Generate click → login redirect; images + settings preserved (localStorage + server sync after login)

## Dashboard (authenticated)
- [x] Dashboard mirrors homepage tool: same upload/reorder/settings component
- [x] Restore all previously uploaded images, ordering, and settings on login
- [x] Soft pink sidebar layout, top bar with cost/usage ring
- [x] Photo sequence timeline: horizontal thumbnails, numbered badges, drag reorder with spring ease, room tag chips
- [x] Fake generation animation for non-paying users: realistic multi-stage progress, then blurred/frosted video preview with pricing popup on top
- [x] Modern pricing popup modal: 4 plans with feature comparison — Starter $9/mo, Pro $39/mo, Annual $29/yr, Business $99/mo
- [x] Real generation flow for subscribers: job created, progress shown, video ready + download
- [x] Project history: past jobs with status indicators (processing, ready, failed), thumbnails, re-download, regenerate
- [x] Stats row with animated count-up numbers

## Billing
- [x] Stripe integration via add_feature
- [x] 4 subscription plans wired to Stripe checkout
- [x] Subscription status checked server-side before any real generation
- [x] Billing portal access from dashboard
- [x] Webhook handling for subscription lifecycle

## Enhancements (Phase 2)
- [ ] Homepage: add richer content sections (testimonials, pricing preview, use cases)
- [ ] Homepage: improve feature cards with icons and better copy
- [ ] Dashboard: add left sidebar with user profile, quick stats, subscription status, navigation
- [ ] Dashboard: enrich main area with stats cards (videos generated, storage used, time saved)
- [ ] Dashboard: add recent activity feed and usage metrics
- [ ] Mobile: add smart bottom navigation bar for dashboard
- [ ] Mobile: responsive sidebar collapse/drawer on small screens
- [ ] Visual verification of all enhancements and mobile responsiveness
- [ ] Final checkpoint and delivery

## QA & Delivery (Phase 1)
- [x] Vitest tests for image ordering, gating logic, job status transitions (15 tests pass: billing auth/pricing, tour styles/labels/hidden fields/ordering guard)
- [x] Visual verification: homepage, dashboard, pricing popup (screenshot verified)
- [x] Checkpoint saved and delivery message
