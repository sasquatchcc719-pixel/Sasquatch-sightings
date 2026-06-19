# Harry teardown — status & handoff (June 18, 2026)

**Decision:** Harry (the LLM SMS agent) is being **shut down for the foreseeable future** — too unreliable, caused repeated live failures. Replace it with deterministic, no-LLM pieces: the existing booking **widget** on vendor pages, and a **dumb Telegram relay** for inbound texts (Charles answers; no AI decides or books). Supersedes `HARRY-NEXT-STATUS.md`.

## Already DONE (all on `origin/main`, deployed)
- **Kill switch** — `HARRY_NEXT_ENABLED` env var **removed** from Vercel prod → new Harry off. Old Harry off via `harry_control_settings` (`global_enabled` + `auto_reply_enabled` = false). ⚠️ Root cause of "can't turn Harry off": the in-app Sasquatch-Sightings switch only ever controlled OLD Harry; new Harry ran off the env flag (design flaw). Both now off.
- **Vendor/NFC pages** (`b131d55`) — `src/components/partners/PartnerLandingLayout.tsx` swaps the "Text Harry" box for `NfcBookingWidget`.
- **Per-location promo codes** — 9 partner codes (GLAM20, HOTS20, MILA20, MOUN20, ROC120, ROCK20, ROSI20, SAFE20, THUY20) registered in `promo_codes` as live **$20 flat** discounts (they were partner labels only, gave $0 before). `use_count` per code = bookings per location.
- **Per-location lead source** (`18e5c24`) — partner bookings send `lead_source_detail` = location name via `NfcBookingWidget`'s `leadSourceDetail` prop, so each location is its own line in stats.
- **Email/copy rebrand** (`b7e7bf5`) — customer-facing "Text Harry" → "Text us at (719) 249-8791" (book page, ContactSection, nurture-leads, Scout chat). Remaining "Harry" = internal comments/prompts only.
- **Milano lead recovery** — +17209801562 (found at Milano, MILA20; Harry escalated/dropped it) got a recovery SMS with the booking link (from 719). Note: Michelle Tsirlis (+12524221396, Milano) — Harry failed her Jun-12 reschedule; her appt is Jun-16 1pm, status completed.

## IN PROGRESS — Telegram relay (Phase 2)
**Design:** Telegram **group + Topics** = one thread per customer (contact card + history at top). Charles replies in-thread → relays to SMS. No LLM.
- **Groups created** by Charles: **"LSA Leads"** and **"Customers"**, both with **Sasquatchnotificationsbot** as **admin**, Topics on.
- Bot has an **active webhook** already (getUpdates 409s) — so it receives updates; "has no access to messages" label is likely moot since it's admin.

**Resume here — build the relay:**
1. Get the two group chat IDs — the relay endpoint should log `chat.id` on first message (don't `deleteWebhook` casually; a webhook is live). Bot token = `TELEGRAM_BOT_TOKEN` in `.env.local`.
2. New table: phone ↔ telegram topic_id ↔ group_id mapping.
3. Inbound SMS (Twilio webhook, `src/app/api/twilio/sms-incoming/route.ts`) → find/create the customer's topic in the right group (LSA leads → "LSA Leads" group; everyone else → "Customers"), post their text + a contact card (name/address/history from `ops_customers`).
4. Point Sasquatchnotificationsbot's webhook at a relay route; on a message in a topic, look up the phone and **send SMS from the SAME business number the customer texted** (Milano lesson: customer texted 866-536-7148, Harry replied from 719 → split thread).
5. Forward **all** inbound (Charles's choice).

## TODO — Phase 4: remove Harry's code (the careful one)
Harry's already off (dead code now), but it threads through many files — **plan before deleting.** Remove: harry-next agent logic (`src/lib/harry-next/`), HarryCommandbot (`src/app/api/telegram/harry-command/route.ts`), old Harry SMS agent, dead auto-lead-creation. **Keep** shared plumbing: Twilio, Supabase, `createAiStyleBooking`, `availability`/`staff-availability`, `lead-sources`, `promo-discount`, `bookable-catalog`, Scout (website chat is separate).

## Key facts
- Supabase project `zoabgmsbvzcqpzlrhsfz`. Vercel project `sasquatch-sightings`.
- Bots: **Sasquatchnotificationsbot** (notifications + will run the relay), **HarryCommandbot** (old command bot — remove in Phase 4).
- Business numbers: **719-249-8791** (main), **866-536-7148** (toll-free / NFC).
- Working branch is `main`; commits go to `origin/main` (auto-deploys; also `vercel redeploy <latest-prod-url>` to force).
- `createAiStyleBooking` now uses per-crew availability (`getAllStaffSlots`) — a time is open if any crew is free.
