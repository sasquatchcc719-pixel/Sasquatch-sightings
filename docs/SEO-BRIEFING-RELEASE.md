# SEO briefing and change-ledger release

## Scope and boundaries

Adds `/admin/marketing/seo`, a role-gated read-only briefing API, and optional structured evidence on the existing marketing timeline. Ledger writes require an explicit Save action and the existing admin/owner/marketing roles. PATCH uses a single atomic ID + revision predicate; stale edits return 409. This release does not change customer workflows, scans, crons, Google review sync, Telegram delivery, indexing or Monday delivery.

Maps uses the latest stored Google Maps carpet-cleaning grid and checks persisted unique points against expected/scanned counts. Organic queries only final Search Console data for the configured www property, deriving two complete, adjacent Monday–Sunday windows in Pacific time. Business rollups remain partial: recorded quote sessions are not qualified SEO leads or revenue attribution. Recorded changes do not imply deployment or causation.

## Migration safety

Apply `20261109150000_add_seo_change_evidence.sql` before deploying code. Adds nullable JSON evidence and an integer revision with constant default zero. Existing event values, RLS and policies remain unchanged. Object/version and nonnegative revision constraints reject invalid shape. Application validation checks all evidence fields. No deletions, renames, backfills or new grants.

Read-only production preflight Nov 9: 10 existing events; table 65,536 bytes; RLS enabled and no public policies; primary key and campaign foreign key retained. Both new columns absent. Latest grid 70f89bd1-f34d-4592-b69d-bd2180372140 has 141 stored/unique points, 26 top-three, 104 nulls. Migration applied successfully Nov 9 after independent review; post-migration preservation is checked before deployment.

After migration, verify columns, constraints, event count, RLS/policies and sample old rows. Deploy only this reviewed diff, preserving concurrent main changes. Verify Vercel READY and production alias. Anonymous briefing and events reads/writes must remain denied. Verify an authorized owner read shows real provenance/status; do not trigger scans or indexing to test.

For write verification use an actual authorized change record, not invented production SEO history. Confirm saved record and revision; stale expected revision must not overwrite. If no suitable real record is approved, keep live write verification explicitly outstanding rather than create fake data.

## Rollback

Revert application commit/deployment if necessary. Leave additive columns and recorded evidence in place: old code ignores them. Do not drop columns or delete ledger rows as rollback. No schedule rollback is needed. A failed code deployment does not require undoing the additive migration.

## Verification

Targeted unit/API suites cover final periods, incomplete scans, unavailable sources, method comparability, authorization, ledger validation and atomic revision conflicts. Run targeted component tests, TypeScript, ESLint and diff checks before release. Avoid legacy production-backed tests. Local desktop and 390px phone layout checked using clearly marked synthetic fixtures; preview fixture route removed. This is not proof of authenticated production rendering.

## Known first-release limitations

Revision checking prevents lost updates but is not an immutable archive of previous edits. The latest 300 timeline entries are loaded for editing. Full baseline and evidence references are available in the editor; the briefing intentionally summarizes them. Live write testing must not manufacture production history.

## Exact quote-to-booking evidence (November 2026)

The business card now reads first-party `booking_funnel_events` directly for the latest completed Monday–Sunday week in America/Denver. It loads all steps of each quote session and joins only the recorded booked-event appointment ID to an existing service appointment with a verified non-internal customer. Pagination is ordered and read failures fail closed. Repeated events/sessions do not inflate distinct appointment counts. Missing, ambiguous, non-service, unknown-customer or temporally inconsistent links stay unresolved; internal/test evidence excludes the entire session.

The displayed window is the quote cohort, not appointment service dates. Status is a current snapshot and includes later bookings; open, completed, cancelled and other are separate. Town uses the appointment's service-address town slug or city and only existing exact named-town/alias mappings, never the customer/billing address, ZIP, landing page or fuzzy matching. Unknown town/source remains explicit. Saved source labels stay separate from Google-referrer evidence; neither proves organic acquisition. No people count, conversion rate, paid revenue, all-business total or SEO impact is claimed.

Read-only baseline for November 2–8: 13 quote sessions, 3 distinct linked service appointments, 2 open, 1 completed, 0 cancelled. Monument has 2 linked appointments (1 open and 1 completed); Castle Pines has 1 open. Saved sources are Nextdoor, repeat customer and Grok, one each. One linked appointment has a Google referrer; paid versus organic is unknown. Ten quote sessions have no recorded booking link. These are not proven lost leads. The reducer reproduces these counts from a privacy-minimized read of existing production evidence.

No migration, tracking collection, customer communication, appointment/price/schedule change, scan or indexing action is included. The exact seven-pin Monument metric and broad-source labels are unchanged. Rollback is an application revert only; no business records need correction. Review subsequent completed quote cohorts and unresolved-link counts, not changes in session totals as proof of SEO results.
