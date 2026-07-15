# EstateTour AI — Project TODO

## Backend & Data
- [x] Drizzle schema: projects, projectImages (with sequenceIndex), generationJobs, subscriptions tables
- [x] DB migration generated and applied
- [x] Supabase Storage upload pipeline with strict sequenceIndex metadata per image
- [x] tRPC procedures: project create/get/update, image upload/reorder/delete, settings persistence
- [x] Official Kling AI integration module (server-side only, hidden from users; sole video provider, no OpenRouter)
- [x] Inworld/Claude prompt optimizer: send all ordered images in one multimodal call and return a structured plan plus Kling prompt
- [x] Kling 3.0 image-to-video generation through the official API, 1080p with audio and watermark disabled, only for active subscribers
- [x] Generation job tracking with status polling (statuses exactly: processing, ready, failed)
- [x] `INWORLD_API_KEY` and `KLING_API_KEY` documented as required server secrets

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
- [x] Modern pricing popup modal: Yearly $29/year (36 videos) first, Monthly $39/month (3 videos), shared 1080p/no-watermark feature set
- [x] Real generation flow for subscribers: job created, progress shown, video ready + download
- [x] Project history: past jobs with status indicators (processing, ready, failed), thumbnails, re-download, regenerate
- [x] Stats row with animated count-up numbers

## Billing
- [x] Stripe integration via add_feature
- [x] 2 subscription plans wired to Stripe checkout
- [x] Subscription allowances enforced atomically: 36/year or 3/month, with a verified one-time $15 additional-video checkout
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
- [x] Vitest coverage for image ordering, gating, client-field hiding, billing, and the official Kling request contract
- [x] Visual verification: homepage, dashboard, pricing popup (screenshot verified)
- [x] Checkpoint saved and delivery message
