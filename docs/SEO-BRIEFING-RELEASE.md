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
