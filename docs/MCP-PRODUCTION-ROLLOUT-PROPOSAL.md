# Sightings MCP production rollout proposal

This is a review proposal, not deployment authorization. Production currently
serves the 11-tool v1.1 server because a later Vercel production deployment from
committed `main` replaced the earlier v1.5 alias. The repair is to deploy current
`main` plus the reviewed v1.5 source commit below. Do not restore or promote the
older v1.5 deployment over newer production code.

## Proposed release

- Version: `1.5.0`
- Endpoint and identity remain unchanged:
  `https://sightings.sasquatchcarpet.com/mcp` and
  `sasquatch-sightings-read`.
- Proposed discovery count: 31 tools.
- Existing 11 tools remain backward-compatible:
  `list_appointments`, `get_appointment`, `list_estimates`, `get_estimate`,
  `search_customers`, `get_availability`, `list_calls`,
  `get_capability_catalog`, `get_business_configuration`,
  `search_business_records`, and `get_operational_summary`.
- New read/draft tools:
  `list_conversations`, `get_conversation`, `get_invoice`, and
  `save_conversation_draft`.
- New confirmed customer tools:
  `preview_customer_update`, `execute_customer_update`,
  `preview_customer_message`, and `execute_customer_message`.
- New confirmed appointment tools:
  `preview_appointment_create`, `execute_appointment_create`,
  `preview_appointment_update`, and `execute_appointment_update`.
- New confirmed estimate tools:
  `preview_estimate_save`, `execute_estimate_save`,
  `preview_estimate_decision`, and `execute_estimate_decision`.
- Confirmed estimate delivery tools:
  `preview_estimate_send` and `execute_estimate_send`.
- Confirmed estimate conversion tools:
  `preview_estimate_conversion` and `execute_estimate_conversion`.

Appointment-change customer notifications, invoice publish/send/payment,
dispatch completion, recurring, commercial, restoration, and service-concern
mutations are not in this release.

## Exact deployment order

1. Record the current production deployment and build the reviewed v1.5 commit
   on top of current `main`. Preserve all newer production functionality.
2. Do **not** apply the controls migration automatically. A read-only production
   inspection on October 13, 2026 found all three MCP control tables and all four
   transactional MCP functions already present, with RLS enabled, no
   `anon`/`authenticated` access, and `service_role` access. The migration is not
   recorded in `supabase_migrations.schema_migrations`, so it was apparently
   installed outside the migration runner. Recheck object presence and grants;
   apply SQL only if that check proves a required object is missing or drifted.
3. Deploy the v1.5.0 application. Do not change the MCP URL, OAuth client ID,
   redirect URLs, installed plugin identity, `/admin`, or `/auth` flows.
4. Verify the staged deployment first, then the custom domain: OAuth discovery,
   unauthenticated 401 challenge, initialization, exact
   31-tool discovery, read-only regressions, 60/minute rate limiting with burst
   100, credential-free request logging, and the checked-in release verifier.
5. Preserve the existing owner grants. This repair does not authorize a new
   scope grant. If a later task approves additional scopes, grant and test them
   separately with synthetic records only.
6. Refresh the existing ChatGPT/Dot connector metadata only after the custom
   domain independently reports v1.5.0 and all 31 tools. Preserve the installed
   OAuth connection and its existing grants.

## Grants and token behavior

`business:read` remains mandatory for every token. Additional live database
grants are intersected with token claims on every request, so revoking a grant
blocks an existing token immediately even if the claim remains in that token.
Newly added grants require a newly issued/refreshed access token before the claim
can contain them; reconnect the existing OAuth account if normal refresh does not
issue the updated claim.

Recommended owner grant sequence:

1. `communications:draft` — save a draft; never contacts a customer.
2. `customers:write` — confirmed allowlisted customer/address changes.
3. `estimates:write` — confirmed draft estimate saves, accepted/declined status
   changes, estimate email delivery, and estimate conversion. Conversion also
   requires `business:write` and `finance:write`; sending or conversion
   communication additionally requires `customer:contact`.
4. `business:write` — confirmed appointment create/update/cancel operations.
5. `finance:write` — additionally required for appointment creation because it
   creates a draft invoice and may synchronize QuickBooks.
6. `customer:contact` — customer SMS/MMS and appointment creation only when the
   exact preview requests customer confirmation.

Do not put these internal authorization grants into the public OAuth scope picker.
They are server-side owner entitlements, not generic client-requested scopes.

## Confirmation and notification behavior

- Every consequential operation has a separate exact preview and execute tool.
  The confirmation is actor-bound, expires in 10 minutes, has a caller
  idempotency key, stores a payload hash, checks the target's current version,
  and is claimed once before execution.
- Customer SMS/MMS previews show the conversation, recipient, retained 719/866
  sender, complete body, attachments, and immediate-contact effect.
- Appointment-create previews show customer/address, exact services and prices,
  total, technician, time window, draft-invoice creation, whether customer
  confirmation will run, whether internal SMS/push/Telegram/reminder alerts will
  run, and whether QuickBooks synchronization will run. Customer notification
  defaults to false; internal notifications and QuickBooks default to true.
- Appointment update/cancel currently rejects `notify_customer=true`. It never
  reports a notification that it did not send.
- Draft estimate saves and accepted/declined status changes do not contact the
  customer. A status change is an internal business record, not an assertion that
  the customer clicked the public decision link.
- Estimate email previews and sends preserve recipient suppression, the exact
  body/fingerprint, signed decision-token expiry, reopen reasons, live record
  checks, and provider idempotency. Provider acceptance is treated as sent even
  when later history/status writes fail, preventing blind duplicates.
- Estimate conversion atomically locks the estimate and writes the service
  appointment, copied measurements, draft invoice and lines, status histories,
  and final converted pointer in one transaction. QuickBooks and explicitly
  requested lifecycle communication run only after commit and return warnings
  that say not to convert again if a follow-up fails.
- Appointment creation, customer/address/blacklist updates, and draft-estimate
  saves now use service-role-only transactional RPCs. Each RPC performs its
  stale/conflict/catalog checks under the same transaction as all core rows;
  external geocoding, communications, reminders, reactivation suppression, and
  QuickBooks work run after commit and return non-retry warnings on failure.
- The admin quote-email route and MCP quote tool now use the same preparation
  and delivery service, including suppression, exact-content fingerprints,
  provider idempotency, reopen reasons, and sent-but-history-failed warnings.

## Rollback

1. Revoke all action scopes first. The live-grant intersection blocks old access
   tokens immediately.
2. Roll the application back to the recorded v1.1 deployment and refresh ChatGPT
   metadata back to 11 tools.
3. Keep the new tables. They contain drafts, confirmation outcomes, and audit
   history and are safe with RLS plus service-role-only grants. Do not drop or
   truncate them during an application rollback.
4. Mark unexpired `pending` confirmations `cancelled` or `expired`. Investigate
   any row left `executing` before retrying because an external side effect may
   already have completed.
5. The expanded token hook is backward-compatible with `business:read`. Restore
   the recorded prior definition only if hook validation itself fails.

## Readiness blockers

- The migration passes a clean PostgreSQL 17 synthetic fixture covering the
  four transactional RPCs, copied measurements, totals/history, duplicate
  replay rejection, service-role-only execution, geocode invalidation, and
  rollback after forced blacklist, estimate-line, and invoice failures. Full
  historical migration replay remains unverified because
  the repository migration directory starts with an ALTER of a pre-existing
  `partners` table and does not contain the production baseline that created it.
- The remaining production blockers are approval to publish the reviewed commit,
  staged deployment, synthetic-only smoke tests, production promotion, custom
  domain verification, and connector metadata refresh. Migration application
  and new scope grants are not part of this repair unless a fresh read-only
  inspection proves a required database object is missing.
- The last full repository baseline passed 1,422 of 1,424 tests; the two known
  failures were in unrelated commercial scheduling/month-availability tests.
  The full suite was not rerun for this local review because repository
  integration tests use `.env.local` and include live-data mutation paths.
- After the final transactional changes, 51 focused tests, type-check, migration
  fixture, diff validation, and the production build pass. OAuth grant
  revocation and fixture-only deployed smoke tests remain rollout checks.

## Exact approval package

One explicit production approval may authorize only these steps, in order:

1. Push the reviewed local v1.5 commit on top of current `main`; do not promote
   the old standalone v1.5 deployment.
2. Deploy that current-main build to a staged URL and run fixture/synthetic-only
   OAuth, read-regression, 31-tool discovery, rate-limit, and release-manifest
   checks.
3. Promote the exact verified deployment and independently run
   `pnpm mcp:verify-release -- https://sightings.sasquatchcarpet.com`.
4. Preserve current OAuth settings and `mcp_authorized_users` grants. Do not
   apply the controls migration or grant new scopes unless separately approved
   after a read-only preflight proves they are needed.
5. Refresh ChatGPT/Dot and Meta Muse connector metadata only after the backend
   verification succeeds, without changing the MCP URL or OAuth identity.

Rollback is scope revocation first, then the recorded v1.1 application. Retain
the MCP tables and audit records; inspect any `executing` confirmation before a
manual retry. This approval does not authorize production customer messages,
real appointment/estimate mutation, payment collection, or broader grants.
