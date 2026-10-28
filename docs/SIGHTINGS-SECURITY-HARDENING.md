# Sightings access-control repair — October 28, 2026

Harry is not connected. Outreach sending remains hard-disabled. Both production
measurement creation gates remain false: `OUTREACH_MEASUREMENT_BOOKING_ENABLED`
in Outreach and `OUTREACH_MEASUREMENT_WRITES_ENABLED` in Sightings.

## Database boundary

- Business roles come from active staff or saved partner membership, never
  editable Auth metadata. Anonymous Auth identities cannot acquire a role.
- Membership lookups deliberately use fixed-path SECURITY DEFINER functions to
  avoid RLS recursion. Only authenticated/service roles can invoke them.
- Private operational, payroll, restoration, backup, agent and integration
  tables are server-only. All application tables have RLS. Public database
  access is limited to services and active public lead-source options.
- Public map/job/share pages and contest intake use explicit server queries
  and safe response fields. Full job/sighting records are not public API tables.
- Partners can register ordinary partner accounts and edit profile fields;
  they cannot grant roles, verify backlinks, award credits or alter balances.
  Referral acceptance and its saved fee commit together through a service-only,
  row-locked, retry-safe function.
- Private views use invoker security; maintenance/trigger RPCs are not callable
  by browsers. Function search paths and future application grants are bounded.
- Direct public image uploads require staff; validated contest uploads remain
  server-mediated. Public images stay readable and private buckets stay private.

## HTTP boundary

- Admin, marketing and analyst endpoints require their intended verified roles.
- Square callbacks require signed staff launch context and matching completed
  card payments retrieved from Square. A redirect alone cannot mark work paid.
- Booking notifications require a secret stored in Supabase Vault and Vercel.
  The trigger only sends to the canonical application URL. Missing credentials
  suppress the alert without preventing legitimate business bookings.
- Twilio signatures/account IDs, Telegram credentials and cron credentials are
  required before effects. The caller press-1/press-2 screening menu is preserved.
- Jobs and sightings polling feeds require header credentials. Existing external
  readers need their own configuration updated before polling resumes. The
  unconfigured stats reader fails closed.
- QuickBooks OAuth requires signed, owner-bound, expiring browser state.
- Location partner PIN checks have an atomic five-attempt account budget per
  15 minutes and uniform failures; their responses and queries stay scoped.

## Verification and limits

Run fixtures with `PGLITE_MODULE` pointing to a local PGlite installation:
`scripts/test-sightings-access-controls.mjs` (77 access checks),
`scripts/test-partner-referral-decisions.mjs`,
`scripts/test-location-partner-pin-limit.mjs`, and
`scripts/test-booking-notification-auth.mjs`.
They use fake records and no network. Default tests exclude both named
integration tests and six legacy tests that load production credentials.

The isolated broad test run passed 2,317 tests; four date-sensitive scheduling
tests also fail on the unchanged starting commit. No real appointment, payment,
customer message or provider authorization was created for verification.

Old unsigned in-flight Square launches require receipt reconciliation; actual
POS note propagation still needs a controlled owner test. Existing partner PINs
have not been reissued or converted to hashes. Public engagement intake still
needs separate abuse-volume controls before a wider campaign. Supabase's
nonrelocatable `pg_net` extension was not dropped or rebuilt merely to remove
an advisory. Owner-deferred compromised-password protection remains deferred.
