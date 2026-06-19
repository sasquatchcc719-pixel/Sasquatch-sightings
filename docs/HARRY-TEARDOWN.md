# Harry teardown — status & handoff (June 18, 2026)

**Decision:** Harry (the LLM SMS agent) is being **shut down for the foreseeable future** — too unreliable, caused repeated live failures. Replace it with deterministic, no-LLM pieces: the existing booking **widget** on vendor pages, and a **dumb Telegram relay** for inbound texts (Charles answers; no AI decides or books). Supersedes `HARRY-NEXT-STATUS.md`.

## Already DONE (all on `origin/main`, deployed)
- **Kill switch** — `HARRY_NEXT_ENABLED` env var **removed** from Vercel prod → new Harry off. Old Harry off via `harry_control_settings` (`global_enabled` + `auto_reply_enabled` = false). ⚠️ Root cause of "can't turn Harry off": the in-app Sasquatch-Sightings switch only ever controlled OLD Harry; new Harry ran off the env flag (design flaw). Both now off.
- **Vendor/NFC pages** (`b131d55`) — `src/components/partners/PartnerLandingLayout.tsx` swaps the "Text Harry" box for `NfcBookingWidget`.
- **Per-location promo codes** — 9 partner codes (GLAM20, HOTS20, MILA20, MOUN20, ROC120, ROCK20, ROSI20, SAFE20, THUY20) registered in `promo_codes` as live **$20 flat** discounts (they were partner labels only, gave $0 before). `use_count` per code = bookings per location.
- **Per-location lead source** (`18e5c24`) — partner bookings send `lead_source_detail` = location name via `NfcBookingWidget`'s `leadSourceDetail` prop, so each location is its own line in stats.
- **Email/copy rebrand** (`b7e7bf5`) — customer-facing "Text Harry" → "Text us at (719) 249-8791" (book page, ContactSection, nurture-leads, Scout chat). Remaining "Harry" = internal comments/prompts only.
- **Milano lead recovery** — +17209801562 (found at Milano, MILA20; Harry escalated/dropped it) got a recovery SMS with the booking link (from 719). Note: Michelle Tsirlis (+12524221396, Milano) — Harry failed her Jun-12 reschedule; her appt is Jun-16 1pm, status completed.

## DONE — Telegram relay (Phase 2) — `70b7cad`, deployed + verified live
Deterministic no-LLM pipe on **Sasquatchnotificationsbot** (`TELEGRAM_BOT_TOKEN`). Inbound SMS → a forum **topic** (one per phone) in the right group with a contact card; Charles replies in the topic → SMS back **from the same business number** the customer texted.
- **Webhook:** `https://sightings.sasquatchcarpet.com/api/telegram/relay`, secret-verified via env **`TELEGRAM_RELAY_SECRET_TOKEN`** (set in Vercel prod). Repointed off the stale `ranger-command` URL (which was 401ing). `RangerEmploymentBot` is a *separate* bot with its own token/webhook — untouched.
- **Group IDs** (auto-discovered by the webhook from a group message; table `telegram_relay_groups`, self-healing): **Customers** `-1004446520884`, **LSA Leads** `-1004421258596`.
- **Tables:** `telegram_relay_groups` (role→chat_id) and `telegram_relay_threads` (phone ↔ group+topic, `business_number`). Migration `20260618130000_telegram_relay.sql`.
- **Code:** `src/lib/telegram/relay.ts` (all logic), `src/app/api/telegram/relay/route.ts` (webhook), and a `forwardInboundToRelay()` call in `sms-incoming/route.ts` after `determineSourceType` (fails soft — never affects SMS). Routing: `sourceType === 'lsa'` → LSA group, else Customers. One topic per phone, reused regardless of group/number.
- **Verified live in prod:** simulated inbound created a Customers topic + card; a synthetic topic reply sent a real SMS (`sms_logs`, type `telegram_relay`, real SID) from the 719 line; wrong webhook secret → 401. Test artifacts cleaned up. Unit/integration tests in `src/lib/telegram/relay.test.ts` (5 passing, real DB, no SMS/Telegram side effects).
- **Last human check (do once):** text **719-249-8791** (and **866-536-7148**) from a real phone → confirm a topic appears in **Customers** with the card, reply in it → confirm the SMS arrives **from the same number** you texted.
- **Note:** an unrelated in-progress harry-command reliability fix (2h staleness TTL on "this customer" context) is still **uncommitted** in the working tree (`harry-command/route.ts`, `command-guards.test.ts`, a reorder in `sms-incoming`) — left as found; commit separately when ready.

## TODO — Phase 4: remove Harry's code (the careful one)
Harry's already off (dead code now), but it threads through many files — **plan before deleting.** Remove: harry-next agent logic (`src/lib/harry-next/`), HarryCommandbot (`src/app/api/telegram/harry-command/route.ts`), old Harry SMS agent, dead auto-lead-creation. **Keep** shared plumbing: Twilio, Supabase, `createAiStyleBooking`, `availability`/`staff-availability`, `lead-sources`, `promo-discount`, `bookable-catalog`, Scout (website chat is separate).

## Key facts
- Supabase project `zoabgmsbvzcqpzlrhsfz`. Vercel project `sasquatch-sightings`.
- Bots: **Sasquatchnotificationsbot** (notifications + will run the relay), **HarryCommandbot** (old command bot — remove in Phase 4).
- Business numbers: **719-249-8791** (main), **866-536-7148** (toll-free / NFC).
- Working branch is `main`; commits go to `origin/main` (auto-deploys; also `vercel redeploy <latest-prod-url>` to force).
- `createAiStyleBooking` now uses per-crew availability (`getAllStaffSlots`) — a time is open if any crew is free.
