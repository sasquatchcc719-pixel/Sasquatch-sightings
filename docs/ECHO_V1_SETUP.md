# Echo V1 — One-Time Setup Guide

You only do this once. After it's done, every published job gets routed through Echo automatically.

## 1. Create two single-action Zaps in Zapier

You need exactly two Zaps. **Do not chain them together — each one is its own Zap.** This keeps you on the free tier (1 task per fire vs. 2 if chained).

### Zap A: Google Updates

| Step | Setting |
|---|---|
| Trigger | **Webhooks by Zapier → Catch Hook** |
| Action | **Google Business Profile → Create Post** |
| Map the Webhook payload fields | `body` → Post summary, `image_url` → Photo, `target_url` → CTA URL, action button = `BOOK` |

After publishing the Zap, Zapier gives you a **Webhook URL**. Copy it.

### Zap B: Facebook Page

| Step | Setting |
|---|---|
| Trigger | **Webhooks by Zapier → Catch Hook** |
| Action | **Facebook Pages → Create Page Post** |
| Map the Webhook payload fields | `body` → Message, `image_url` → Link/Photo, `target_url` → Link |

Copy this Webhook URL too.

## 2. Set the env vars in Vercel

Add these to your Vercel project's environment variables (Production + Preview):

```
ZAPIER_GOOGLE_WEBHOOK_URL=<Zap A webhook URL>
ZAPIER_FACEBOOK_WEBHOOK_URL=<Zap B webhook URL>
```

You can also **remove** the old dead one:

```
ZAPIER_WEBHOOK_URL  ← delete this, nothing reads it anymore
```

Redeploy after setting them (or let the next push trigger a deploy).

## 3. The webhook payload Echo sends

For both Zaps, Echo POSTs this JSON to your webhook:

```json
{
  "job_id": "uuid",
  "slug": "carpet-cleaning-woodmoor",
  "service": "Pet urine treatment, stair cleaning",
  "city": "Monument",
  "neighborhood": "Woodmoor",
  "image_url": "https://...job-images/...jpg",
  "body": "the generated post copy",
  "target_url": "https://sightings.sasquatchcarpet.com/jobs/...",
  "style": "before_after"
}
```

Map these fields in each Zap's action step. The `body` is the actual post text; `image_url` is the real job photo; `target_url` is where you want the CTA button to send people (the job page).

## 4. Verify the wiring

1. Visit `/admin/social-posts`. You should see the new **Echo Controls** panel above the tabs.
2. Confirm **Echo is ON** and **Drafts for approval** is selected (default for V1 — auto-post is OFF).
3. Confirm both **Google Updates** and **Facebook Page** channels are toggled ON.
4. Publish a test invoice through the existing job tab flow.
5. Go back to `/admin/social-posts` → Drafts tab. You should see a new draft created by Echo with varied copy (no "Just wrapped up…" opener).
6. Tap **Approve & Post**. Within ~10 seconds, the post should appear on your Google Business Profile and your Facebook Page.
7. Check the **Drafts** tab — the draft's status should flip to "Posted".

If something fails: open the Supabase dashboard, query `social_post_log` for the most recent row — `reason` will tell you exactly what went wrong (auth, validation, etc.).

## 5. When you trust it enough, flip to auto-post

After you've seen 20–30 drafts that you'd have approved anyway, toggle **When a job finishes → Post automatically** in the Echo Controls panel. Echo will fire posts without waiting for your tap. You can flip it back any time.

## What changed in your codebase

- New: `src/lib/echo/` module (types, settings, generator, decide, delivery, enqueue)
- New: `/api/admin/echo/settings` endpoint
- New: `echo_settings`, `social_post_log` tables; `social_post_drafts` extended with `job_id`, `style`, `skip_reason`
- Modified: `src/app/api/admin/ops/invoices/[id]/publish/route.ts` now hands off to `echo.enqueue()` instead of trying to post directly
- Modified: `src/app/api/admin/social-post-drafts/[id]/post/route.ts` now uses Echo's delivery layer
- Modified: `src/app/admin/social-posts/page.tsx` now has the Echo Controls panel
- Removed: weekly Anthropic-backed cron `social-draft-generator` (was producing zero drafts since April)

The old `GOOGLE-UPDATES-CONTENT-ENGINE-PLAN.md` is now superseded by `ECHO_V1_SPEC.md`.

## What's deferred (not in V1)

- Image generation (Gemini / OpenAI image API)
- Blog / field-notes layer
- Telegram approval flow
- Instagram / LinkedIn / Pinterest channels
- Review-reply automation
- Authority/seasonal content not tied to a job

These can be added later as V2 features.
