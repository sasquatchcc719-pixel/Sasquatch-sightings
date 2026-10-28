# Unscheduled job follow-ups

Parked appointment cards have a required next follow-up date, using America/Denver. New parking defaults to three calendar days later. Existing overdue parked appointments start due on the release day. This date is a review task, not permission to contact a customer. Restoration-monitor visit queues are separate.

Private `ops_unscheduled_follow_ups` rows keep the date, latest review note, reviewer, review time and optimistic-lock timestamp. Appointment triggers close the follow-up on un-parking and reset it on a new parking cycle. They do not send messages, create bookings or alter appointment times. The admin-only calendar endpoint and MCP tool use the same save function. Browser table access is revoked; only server operations access this metadata.

`list_unscheduled_appointments` includes `follow_up.next_follow_up_date`, `due`, `reviewed_at`, `review_note` and `updated_at`. Paginate through the whole queue. `set_unscheduled_follow_up` requires the existing `business:write` grant, appointment ID, next date, current `expected_updated_at` and a meaningful review note. A stale or resolved task is rejected; re-read rather than overwriting it. A review is not a customer contact attempt. Check conversations and actual provider-backed contact history independently.

## Harry scheduling handoff

The owner selected Harry's native ChatGPT task as the sole recurring reviewer. This release does not create a second Codex automation, clone the incoming-SMS subscription or fabricate an incoming message. Its existing incoming-SMS event subscription is unrelated to date-based checks.

Paste this once into Harry's task:

> Create a recurring task in this Harry chat to check Sightings Unscheduled jobs every day at 9 AM and 2 PM America/Denver, and do the first check now. Use list_unscheduled_appointments and paginate through all records. Review jobs whose saved follow_up.due is true. Re-read each customer's latest conversation and appointments before acting; skip work already booked, recently handled or deferred by the customer. Continue follow-ups only within my existing instructions and contact permissions; do not duplicate outreach or invent appointment openings. Record the actual review outcome and next appropriate date with set_unscheduled_follow_up, using the current follow_up.updated_at as expected_updated_at. Honor an explicit customer-requested date; otherwise normally review again in three days. Do not roll a date forward merely to hide an unresolved task. Stay quiet when nothing needs attention; notify me about meaningful progress, a blocked task or a failed check. Confirm that the recurring task was actually created, show the next run, and report any unavailable tool instead of claiming the automation is active.

The recurring schedule is not active until Harry confirms creation. If the native tool catalog has not refreshed to MCP 1.7.0, its new write tool must be made available before claiming a complete review/update cycle.

## Verification

- Focused Vitest suites cover Denver due boundaries, valid dates, optimistic locking, scope checks, calendar controls and failed saves.
- `node scripts/test-unscheduled-follow-up-db.mjs /absolute/path/to/pglite/dist/index.js` uses only synthetic in-memory PostgreSQL. It covers initial backfill, DST, parking, rescheduling, re-parking and private grants. It reads no environment file or production credentials.
- Production verification uses read-only calendar/MCP reads and checks that every currently parked appointment has an unresolved follow-up row. No customer messages or bookings are used as tests.

## Contact history and exact next-attempt time

Click an unscheduled appointment to see Harry’s next saved plan, an optional Mountain time, and the latest 100 recorded customer communication and follow-up events. The history reads existing SMS delivery logs, linked conversations, phone-matched calls and operational email logs. Delivery failures and inbound calls retain their factual labels; customer communications may relate to other jobs. Missing timestamps remain unknown. Opening a card is read-only.

Every dashboard or MCP follow-up save now appends a private `ops_unscheduled_follow_up_events` entry in the same transaction as the plan update. Reviews and plan changes are distinct from actual contact attempts. Earlier overwritten notes cannot be recovered; the migration preserves the previously saved latest review. New parking cycles clear old exact times but retain the event history.

Harry can pass optional `next_follow_up_time` in 24-hour `HH:mm` America/Denver together with `next_follow_up_date` and the current version to `set_unscheduled_follow_up`. Record the actual outcome in `review_note` and the intended next attempt after each review. Date-only clients remain supported and clear any prior exact time. The UI exposes overdue or missing plans; it does not claim the separate Harry recurring task is active.
