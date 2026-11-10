# Review SMS reliability

The existing campaign copy, eligibility rules, 48-hour completion lookback, 180-day cooldown, Mountain-time 09:00–18:59 send window, five-minute cron and ten-request batch limit are unchanged. Existing SMS opt-outs now suppress enqueue and are rechecked immediately before submission, by customer ID or normalized handset. A failed suppression lookup fails closed; this does not introduce a new opt-in requirement.

## Evidence and correlation

- `review_requests.status = 'sent'` is retained for compatibility with the cleaning-reminder separation and conversation context. It means Twilio accepted the request, not handset delivery.
- New requests store a submission claim and the returned Twilio SID. Their existing customer ID is also passed into `sms_logs`.
- `delivery_status` starts as `unknown`. A successful submission records `accepted`; only an authenticated Twilio status callback records `delivered`, `undelivered`, or provider failure. Historical delivery remains `unknown` and is not backfilled or retried.
- Review-only callback URL: `/api/twilio/review-status?request=<existing request UUID>`. The sender builds this fixed destination. Other SMS flows retain their existing sender, callbacks and logging behavior.
- The callback validates the existing Twilio account and request signature, including the request UUID in the URL, before obtaining a database client. The database function locks the claimed request, rejects mismatched SIDs and ignores duplicate/out-of-order state regressions. Early callbacks survive the later acceptance/log write.
- The function is `SECURITY INVOKER`, with a fixed search path, and executable only by `service_role`. The migration adds no public table-write privileges.

## Deployment and verification

Apply `20261110024707_review_request_delivery_tracking.sql` before deploying the updated sender. The migration is additive: it does not modify appointment/customer records, send texts, change campaign parameters or infer historical delivery.

Run the mocked unit tests for `review-requests.unit`, `review-tracking`, `review-status`, existing `gap-status` and `inbound-auth`. Test the SQL in a disposable in-memory PostgreSQL instance with `node scripts/tests/review-delivery-migration.mjs <temporary PGlite install directory>`; never point tests at production. The script accepts only a local dependency directory, not database credentials or a connection URL.

Production checks are schema/privilege reads, exact-commit deployment verification, and an unsigned callback that must return 403 before database access. Do not invoke the review cron or send a customer test message. A passing isolated callback test does not establish that a real customer received an SMS; that remains pending until a natural signed callback arrives.

## Uncertain outcomes and rollback

A compare-and-set submission claim prevents overlapping cron runs from submitting the same row. Claims are never automatically reclaimed: a provider timeout or process crash may have occurred after acceptance. An ambiguous failure remains pending with its claim intact, retains the 180-day customer cooldown, keeps delivery unknown, and records that no retry is permitted. A later signed callback can resolve it. Tracking-write failures preserve the accepted SID when a fallback write is possible.

Prefer a forward fix. Additive columns can remain when rolling back unrelated application code. Do not restore the pre-claim sender while claimed pending rows exist: it ignores claims and could replay an uncertain send. First inspect claimed pending rows and their provider evidence without sending; leave ambiguous requests suppressed from replay. Do not clear claims, backfill statuses, or drop tracking evidence to make a rollback look clean.
