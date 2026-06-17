# Harry-next — status (end of June 16, 2026)

New Harry is built on `src/lib/harry-next/`, runs **alongside the untouched old Harry**,
behind the `HARRY_NEXT_ENABLED` env flag (currently ON in production). Old Harry's
auto-reply is OFF (`harry_control_settings`: global_enabled + auto_reply_enabled = false).

## What's live (all on `main`, deployed, ~47 unit tests green)

1. **Service removal** — customer (known, one upcoming job) texts "take the closet off" →
   Telegram approval card → you tap **Approve** → the one line is removed, total + invoice
   recomputed, customer messaged. Says-what-it-does; can't collapse or invent numbers.
2. **Booking** — new lead texts to book → Harry gathers services/name/email/address/lead
   source/day+time (in your brand voice), then sends an approval card → Approve → books via
   `createAiStyleBooking`, assigning whichever crew is free.
3. **Company Q&A** — answers general questions from `harry_knowledge_blocks` on its own;
   escalates water emergencies / upset customers / anything uncovered to you on Telegram.

## How the safety holds
- Model picks services from a **numbered menu of your real catalog** (the same bookable set
  the website shows — `src/lib/ops/bookable-catalog.ts`); it can't invent a service or
  collapse them. Defaults to standard cleaning (Legendary only on explicit request).
- Code owns every **number** and every **action**; the model owns the **wording** only.
- Availability is **per-crew** (matches the website) — `createAiStyleBooking` now uses
  `getAllStaffSlots`.
- Approval cards + buttons go through **HarryCommandbot** (the interactive bot).

## How to test in the morning (from your phone)
- **Booking:** text "I'd like to book a cleaning" and walk through it → card → Approve.
- **Removal:** from a number with one upcoming job, "take the closet off" → card → Approve.
- **Q&A:** "are your chemicals safe?" (answers) · "my basement flooded" (escalates to you).

## Kill switch
Set `HARRY_NEXT_ENABLED=false` (Vercel, production) + redeploy → new Harry fully off,
nothing else changes.

## Known limitations / next
- Booking asks the customer's preferred time; **you vet it on approval** (Harry doesn't yet
  proactively offer open slots).
- "Office recommends a different time" counter-proposal flow: designed, not built.
- Legendary-Restoration default is a model rule + your approval backstop (not 100%
  deterministic); can be hard-excluded from Harry if you'd rather those route to you.

Plan/architecture: `docs/HARRY-REBUILD-PLAN.md`.
