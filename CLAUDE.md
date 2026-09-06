# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm dev          # Start dev server (Next.js)
pnpm build        # Production build
pnpm lint         # ESLint
pnpm type-check   # tsc --noEmit
pnpm test         # Vitest (watch mode)
pnpm test:ci      # Vitest (single run)

# Run a single test file
pnpm test:ci src/lib/some-util.test.ts
```

Deploy via Vercel CLI (`vercel --prod`). Apply DB migrations via Supabase CLI (`supabase db push`). Never ask Charles to run these manually.

## Architecture

**Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind CSS 4, shadcn/ui, Supabase (Postgres + Auth + Storage), Vercel hosting, Twilio (calls/SMS), Retell AI (voice agent), OneSignal (push), QuickBooks.

**Two Supabase client patterns — never mix them:**
- `createClient()` in `src/supabase/server.ts` — cookie-based SSR, respects RLS, for authenticated user requests
- `createAdminClient()` in `src/supabase/server.ts` — service role key, bypasses RLS, server-only (never import in client components)

**Route structure:**
- `src/app/(public)/` — customer-facing pages
- `src/app/admin/` — staff-only dashboard (auth-gated)
- `src/app/api/` — API routes (webhooks, AI tools, cron handlers)

**AI agents:**
- **Harry** (`src/lib/harry/`) — SMS dispatcher. Handles post-call follow-ups, appointment reminders, inbound SMS triage. Always active.
- **George** (`src/app/api/admin/george/`) — Admin AI agent for back-office tasks (phone settings, QuickBooks, scheduling). Enabled by default; `GEORGE_HENDERSON_ROLLOUT_MODE=confirm_actions` in production.
- **Rabecca** (`src/lib/retell/`) — Voice AI (Retell). Gated by `REBECCA_VOICE_ENABLED` env var. Never wired into live call routing — only gates the `/api/retell/functions` endpoint.

**Call routing flow:**
Twilio inbound → `/api/twilio/call-router` → business hours check (9am–5pm MT Mon–Fri from `phone_settings`) → IVR menu (press 1: book/change an appointment, press 2: active water damage routed to Charles + browser client) → `/api/twilio/ivr-menu`. After hours, callers can still press 2 for active water damage; no input or any other selection goes to `/api/twilio/call-after-hours` (voicemail + SMS). All forward numbers and business hours come from the `phone_settings` table, not hardcoded values.

**Cron jobs** (13 total in `vercel.json`): job reminders every 5 min, Gmail intake + task worker every 10 min, daily SERP tracking, QuickBooks sync, booking cleanup, and more.

## Key Rules

**Never use Mapbox geocoding** — the project uses a different geocoding approach; Mapbox will cause data issues.

**Never auto-publish** content (blog posts, public listings) — always require explicit admin action.

**Booking/service catalog** is defined in a specific DB table, not hardcoded. Read from there; don't invent prices or service names.

**Role-lookup SQL functions must be `SECURITY DEFINER`** — if you write a SQL function that checks a user's role, it must include `SECURITY DEFINER` or it will fail under RLS. This is a known footgun; do not skip it.

**Agent orchestration isolation** — keep agent logic in its own module (`src/lib/harry/`, `src/lib/retell/`, etc.). Don't let agent code bleed into UI components or shared utilities.

**Never fabricate business details** — phone numbers, addresses, prices, and service details must come from the DB or be explicitly provided by Charles. Do not invent them.

**Push to main directly** — no feature branches or PRs unless Charles explicitly asks.

## Testing

Tests use Vitest with jsdom. Integration tests hit a real Supabase DB — do not mock the database. After changing any tool or agent function, exercise it against the real DB before marking it done. See `AGENTS.md` for agent-specific test guidance.
