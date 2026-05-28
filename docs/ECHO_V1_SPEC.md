# Echo V1 Spec

**Status:** Active — supersedes `GOOGLE-UPDATES-CONTENT-ENGINE-PLAN.md` (kept for history).
**Owner:** Charles
**Last revised:** 2026-05-27

## Purpose

A small, predictable content engine that turns every finished job into either a varied, non-repetitive social post on Google Business Profile + Facebook Page, or a quiet map-only entry. Lives entirely inside Sasquatch Sightings. Operates within Zapier's free-tier task budget (100/month). Built on OpenAI. Has real controls in the admin dashboard, not just metrics.

Not an autonomous agent. A workflow with one decision function and a couple of LLM calls.

## What it replaces in existing code

- The dead distribution leg of `src/app/api/admin/ops/invoices/[id]/publish/route.ts` (the `ZAPIER_WEBHOOK_URL` block and the direct Google Business API call, both of which have produced zero successful posts).
- The "repetitive copy" pain: the existing `src/app/api/generate-description/route.ts` already has 6 rotating styles but no memory and no opener ban-list, so the model defaults to "Just wrapped up…" half the time.
- The Anthropic-backed weekly cron `src/app/api/cron/social-draft-generator/route.ts` (zero drafts produced since creation; retired in V1).

What stays untouched: job/image/map-page creation, the existing 6 style instructions in the generator (we add memory + ban list around them), and the admin page shell at `src/app/admin/social-posts/page.tsx` (we add a settings panel above the existing tabs).

## Architecture

Three thin layers, each independently testable.

```
publish/route.ts ──► echo.enqueue(job)
                            │
                            ▼
                    decide(job, recent)  ◄── generation (varied copy)
                            │
              ┌─────────────┼─────────────┐
              ▼             ▼             ▼
          map-only       draft         skip
                            │
                  (auto-post OR await approval)
                            │
                            ▼
                    delivery.fire(draft)
                            │
                ┌───────────┴───────────┐
                ▼                       ▼
        Google Updates Zap      Facebook Page Zap
                │                       │
                └──► social_post_log ◄──┘
```

## Database schema

Three migrations, applied via Supabase MCP.

**`echo_settings`** — single-row config table. Read on every Echo invocation; written by the admin settings panel.

| Column | Type | Default | Notes |
|---|---|---|---|
| id | int | 1 | enforced single row |
| enabled | bool | true | global on/off kill switch |
| auto_post | bool | false | true = fire immediately; false = require approval |
| google_enabled | bool | true | per-channel toggle |
| facebook_enabled | bool | true | per-channel toggle |
| weekly_cap | int | 3 | max posts per channel per ISO week |
| updated_at | timestamptz | now() | |

**`social_post_log`** — per-attempt audit trail. One row per (job_id, channel) attempt.

| Column | Type | Notes |
|---|---|---|
| id | uuid | pk |
| job_id | uuid | fk → jobs |
| draft_id | uuid | fk → social_post_drafts (nullable) |
| channel | text | 'google' \| 'facebook' |
| status | text | 'success' \| 'failed' \| 'skipped' |
| reason | text | human-readable for skips/failures |
| request_payload | jsonb | what we sent to Zapier |
| response | jsonb | Zapier's response or error |
| attempted_at | timestamptz | now() |

UNIQUE constraint on `(job_id, channel)` where `status = 'success'` to prevent double-posting on retry.

**`social_post_drafts`** — existing table. CHECK constraint on `post_type` extended to accept Echo's types: `'recent_work', 'authority', 'offer', 'event', 'business_update'` (kept alongside the legacy values for backwards-compatibility with the old admin page rendering).

Two new columns: `job_id uuid` (fk → jobs, nullable for non-job drafts) and `style text` (which of the 6 styles produced it; used for memory).

## Code structure

```
src/lib/echo/
  types.ts          — shared types (EchoSettings, Draft, LogRow, Decision)
  settings.ts       — getSettings(), updateSettings()
  generator.ts      — generateCopy(job, recentStyles): { body, style }
                      wraps the existing 6-style prompt + adds opener ban list + memory
  decide.ts         — decide(job, recentPosts, settings): Decision
                      single function: skip | map-only | draft | auto-post
  delivery.ts       — fire(draft, channels): logs each channel attempt to social_post_log
                      idempotent on (job_id, channel); bounded retry (3 attempts)
  enqueue.ts        — enqueue(job): called from publish/route.ts; orchestrates the above
src/app/api/admin/echo/
  settings/route.ts          — GET, PATCH
  drafts/[id]/approve/route.ts
  drafts/[id]/reject/route.ts
src/app/admin/social-posts/page.tsx — add settings panel above existing tabs
```

## Generation rules

- Wraps the existing 6 styles in `generate-description/route.ts` unchanged.
- Adds **style memory:** before generating, read the last 5 draft `style` values from `social_post_drafts`. Exclude those from random selection. With 6 styles and last-5 excluded, only 1 style is eligible — so soften to "exclude last 3 styles" (eligible pool = 3 styles minimum).
- Adds **opener ban list** to the system prompt: explicitly forbid "Just wrapped up…", "Today we…", "We just finished…", "Did another…". The model is told to vary the first 5 words of every post.
- Uses real line-item names from the appointment (e.g. "pet urine treatment," "stair cleaning") rather than the resolved parent service ("Standard Carpet Cleaning") for both generation context AND the admin card display.
- Drops the 🦶 emoji requirement (no visible posts have ever included it; the rule wasn't being enforced and Google posts don't need it).

## Decision rules

`decide()` returns one of: `auto_post`, `draft`, `map_only`, `skip`.

- `skip` (don't even enqueue) when: city is "Unknown" or null; OR no usable image.
- `map_only` (job page only, no social) when: same service + same city posted in last 3 days.
- `draft` when: settings.auto_post is false; OR weekly cap would be exceeded; OR confidence flags (commercial customer, uncertain image, offer/event content).
- `auto_post` when: settings.auto_post is true AND no draft conditions trigger AND under weekly cap.

Decision rationale (the `reason` string) is always recorded — visible on the admin page next to skipped/queued jobs.

## Approval flow

1. Echo writes a draft to `social_post_drafts` with `status = 'draft'`.
2. Admin sees it on the existing Drafts tab; reviews body, taps **Approve & Post** (existing button).
3. Approve hits `/api/admin/echo/drafts/[id]/approve` → calls `delivery.fire(draft, ['google', 'facebook'])` (filtered by per-channel settings).
4. Each channel attempt writes a row to `social_post_log`. Draft status flips to `'posted'` only if at least one channel succeeded.
5. On total failure: draft status flips to `'failed'`; admin sees the error inline; one-click retry available.

## Delivery & failure handling

- Fires the Zap webhook with a JSON payload containing: `job_id`, `slug`, `service`, `city`, `neighborhood`, `image_url`, `body`, `target_url`, `style`.
- Idempotent: `social_post_log` UNIQUE on `(job_id, channel) WHERE status = 'success'`. A retry after success is a no-op.
- Retry policy: up to 3 attempts on transient failures (5xx, network errors). Permanent failures (4xx, malformed payload, channel disabled) fail immediately with the error logged.
- Validation at boundary before firing: city present, body 1–1500 chars, image_url resolves to https.

## Settings UI

A single Settings card above the existing tabs on the admin page:

- **Echo: ON / OFF** toggle (red when off)
- **When a job finishes:** "Draft for approval" / "Post automatically" radio
- **Channels:** Google Updates ON/OFF, Facebook ON/OFF (independent checkboxes)
- **Weekly cap:** number input, default 3, range 0–10

Plus two visibility tweaks:
- "Why skipped" label appears next to each item in the Skipped section of Job Posts tab (e.g., "posted in Monument 2 days ago," "no city data").
- "Next up" banner at top of Drafts tab when at least one draft is approved and queued.

## Out of scope for V1 (explicitly deferred)

- Image generation (Gemini / OpenAI gpt-image-1)
- Blog / field-notes layer
- Telegram conversational interface
- Free-form NLU
- Instagram / LinkedIn / Pinterest channels
- Review reply automation
- Authority/seasonal content not tied to a job
- Priority cities / posting time windows

Each can be added later without restructuring V1.

## Setup checklist (one-time, after deploy)

1. Charles creates two single-action Zaps in Zapier:
   - Zap A: Webhook trigger → Google Business Profile → Create Post
   - Zap B: Webhook trigger → Facebook Pages → Create Page Post
2. Copies each Zap's webhook URL into Vercel env as `ZAPIER_GOOGLE_WEBHOOK_URL` and `ZAPIER_FACEBOOK_WEBHOOK_URL`.
3. Removes the dead `ZAPIER_WEBHOOK_URL` env var.
4. Visits `/admin/social-posts`, confirms Echo is **OFF** by default, reviews settings, flips to **ON** when ready.
5. Publishes a test invoice; verifies a draft appears in the Drafts tab; approves it; verifies posts land on Google + Facebook.

## Acceptance criteria (5 integration tests)

Per the repo rule, exercised against the live Supabase DB:

1. `publish` enqueues correctly: publishing an invoice creates a `social_post_drafts` row when Echo is ON and `auto_post = false`.
2. `decide()` picks an unused style: given a fixture of recent drafts using styles A/B/C, the next call returns a style ∉ {A, B, C}.
3. `approve` fires the (test) webhook: a draft approval writes a `social_post_log` row with `status = 'success'` when the test webhook returns 2xx.
4. Failed webhook logs to `social_post_log`: a draft approval against a 500-returning webhook writes `status = 'failed'` with the error body in `response`.
5. Kill switch stops queuing: with `settings.enabled = false`, publishing an invoice creates a job but no draft and no log rows.

---

When V1 ships, this spec is the single source of truth. Anything beyond it goes through a new version bump, not a side-build.
