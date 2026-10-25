# Gap management review package

Local branch: `codex/gap-management`, based on deployed main `60391b455ec12562d110650552ec514f990ce306`. No push, merge, deployment, migration application, production configuration change, campaign activation, real messages, or customer record changes are authorized or performed by this implementation task.

## Behavior for review

Harry can read next week's actual staff/calendar gaps, lead with internal daytime holes, and review the oldest eligible returning customers with service-date provenance, prior job duration, address/neighbor ZIP evidence, verified straight-line detour where coordinates permit it, consent provenance, recorded outreach across channels, and specific exclusions. Travel remains inside existing scheduled blocks. No planning read creates a campaign, consent, geocode, availability default, or hold.

Existing appointments are anchors. The implementation never moves them. Tuesday's accepted Denise 09:00–10:00 visit remains protected. A complete three-hour job can be tested for 10:00–13:00 before Donna; overlapping 10:00–12:00 and 11:00–13:00 alternatives are one gap. A customer-requested alternate start, including a fitting off-grid start such as 10:30, goes through the same full-duration hours/overlap rules. Adjacency is a priority, not a condition for accepting a booking.

One preview names 1–5 specific customers and exact server-generated message bodies, retained sender, calendar version, offer terms, and a ten-minute approval expiration. Execution requires the separate `outreach:write` plus `customer:contact` grants and `GAP_OUTREACH_ENABLED=true`. None is granted or enabled by this branch/migration. No recurring worker, automatic second wave, substitute recipient, or owner Telegram post is introduced.

Only the preview's owner can execute it. Batch approval and recipient claims are atomic. Each remaining send rechecks current eligibility, complete gap version and live booked/block intervals. Bookings on any channel, duplicate-customer bookings, new email/SMS contact, replies, explicit owner takeover, opt-outs, permission revocation and stale approvals suppress pending work. The application rechecks evidence before claims and the database checks authorization, consent, contacts and live calendar again. A network/provider/persistence exception stops the batch and preserves uncertainty; it does not retry an SMS blindly. Provider acceptance and final delivered/failed callbacks are separate, signed/account-validated states. The new ledger preserves contact evidence even if a legacy SMS log write fails.

An SMS already in flight cannot be recalled. A booking that commits after final preflight and while the external provider request is in flight can race that one invitation; subsequent unclaimed invitations stop. No distributed atomicity with Twilio is claimed.

## TF35: user-confirmed rules

- $35 off **at least $300 in service subtotal before the discount**.
- $300 service → $265 before other applicable charges.
- $299.99 and the $175 minimum job do not qualify; travel/fees/tax cannot unlock the offer.
- No automatic stacking with multi-rug, manual dollar, negative-line/credit, or other discounts.
- Preserve services/prices and obtain agreement on the real complete slot before booking.

TF35 already exists in the tracked original migration and invoice/PDF support. The old seed's $250 tier diverged from campaign snapshots enforcing $300. The new workflow uses its approved terms snapshot rather than an unrelated agent promotion or that stale global tier. It uses the existing TF35 name and existing scalar invoice discount plus `discount_metadata.promo`, with a source/redemption identity. No live coupon record is created or changed.

The MCP booking preview shows $35 and matching metadata; its atomic transaction wrapper locks the invitation, validates the recipient, full duration, service-only threshold and exact totals, creates the appointment/draft invoice through the existing transaction, writes metadata and consumes the invitation in that same transaction. Reuse cannot redeem the invitation twice. Estimate-conversion preview and transaction use the same math, full-duration guard, identity and metadata. Existing normal booking/estimate behavior is preserved when no gap offer is provided.

Public private-token checkout now calculates service-only qualification/duration, uses its campaign's snapshotted offer amount in review and booking, prevents stacking, and saves the campaign minimum on the invoice. It still supports the existing choice of another upcoming date. NFC review suppresses its automatic rug discount for private offers so review and submit agree.

For the new liaison offer, customers may request any actually available slot. If that slot falls outside the targeted gap, applying TF35 requires the explicit `approve_alternate_offer` decision in the booking/conversion preview. This separates accepting alternate-time work from assuming the gap promotion automatically covers every date. The message welcomes alternate times and promises to confirm services, price and time. This unresolved promotion-policy boundary is visible for owner review; it does not prohibit an alternate booking at normal terms.

Admin and tech invoice edits project the complete intended service lines against canonical catalog identity and excluded rows before any contact, bonus or financial writes. Invalid retained offers are rejected before those writes; explicit removal/replacement clears the old offer provenance. The exclusion workflow also checks a retained offer before reducing qualifying work. A database invoice guard rechecks saved terms. Bare new TF35 application through staff coupon fields requires the approved offer context; ordinary owner-entered manual discounts remain the preexisting workflow.

Legacy invoice editors still use multiple HTTP/database operations; the preflight prevents the invalid-TF35 edit failure identified in review, but this branch does not claim full transactional protection against concurrent editor changes or unrelated persistence failures. Turning all invoice editing into a new transaction system is outside this focused change. Historical TF35 invoices without a saved offer snapshot are not silently rewritten. Existing generic saved/emailed estimate drafting is unchanged: the new promotion is supported in booking preview and estimate **conversion** preview, not automatically added to every saved/emailed estimate.

## Interfaces

Release manifest moves to MCP 1.6.0 with the original tools preserved and these six additions:

| Tool                   | Effect                                                                                                                             |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `get_schedule_gaps`    | Pure bounded date-range read; complete duration, protected neighbors, internal-first ordering and explicit alternate-time test     |
| `get_gap_candidates`   | Pure current-gap read; oldest service first with provenance, duration/location evidence, recorded contacts, consent and exclusions |
| `get_gap_outreach`     | Read exact batch, recipient/provider state, uncertainty, stops and linked appointment                                              |
| `preview_gap_outreach` | Save exact expiring approval; no contact or consent creation                                                                       |
| `execute_gap_outreach` | Execute only the approved bounded batch after separate activation/grants                                                           |
| `stop_gap_outreach`    | Owner takeover; suppress remaining pending work                                                                                    |

Booking and estimate-conversion inputs gain optional `gap_offer_id` and explicit `approve_alternate_offer`. Existing single-customer send tools are not used to evade bounded campaign controls. Existing inbound MCP event support and human Telegram relay are reused conceptually; this task creates no event subscription or automation.

## Verification

Final local results: **113 tests in 20 selected suites pass; 15 isolated PostgreSQL scenarios pass; TypeScript, targeted ESLint, formatting/diff checks, and the webpack production build pass**. Build credentials were placeholders and the database URL was localhost port 9. No real provider or database mutation test was run.

- `scripts/test-gap-management-unit.sh`: selected mock/pure suites; no production-backed test was invoked. Includes schemas/discovery/release identity, calendar/alternate-time behavior, eligibility and all-channel cooldown, consent, duplicates, owner takeover, concurrent worker attempts, fill stop, uncertainty, invoice preflight, coupon boundaries and pricing/UI regressions.
- `node scripts/test-gap-outreach-db.mjs`: proposed migration compiled with the actual existing MCP transaction functions, then 15 isolated PostgreSQL scenarios covering approval/claims, stale approval cleanup, opt-out/revoked grant, SMS/email takeover, booking/alias stop, uncertainty/delivery reconciliation, $300→$265 atomic booking and conversion, reuse rejection, service-vs-fee threshold and complete-duration enforcement.
- The database fixture uses pinned `@electric-sql/pglite@0.3.14` in the task's separate test-runtime directory, installed from the official npm registry with install scripts disabled. It loads no `.env`, makes no server connection, and changes no app dependencies. [PGlite uses one exclusive connection](https://pglite.dev/docs/), so overlapping queued operations do not prove true multi-session lock contention.
- TypeScript, targeted ESLint, formatting and `git diff --check` are part of final validation. Build uses fake OpenAI/Resend/Supabase values and `http://127.0.0.1:9`, not production credentials. Initial attempts encountered missing build keys and restricted font downloads; final result is recorded in the task's build log.
- Docker daemon is unavailable. Its harmless availability check failed before any container was created; true multi-session PostgreSQL contention remains a release check. The earlier auto-review dependency-download rejection was resolved after the later implementation/testing authorization was supplied; the one authorized retry succeeded.

## Release approval boundaries

1. Review the local commit/diff and test results. No push or merge has been performed.
2. Before production release, run the PostgreSQL fixture and separate-session race tests in isolated CI/staging, exercise actual admin/tech retained-offer edits and the exclusion flow, and review the migration's triggers/permissions. These are not live customer tests. Keep existing generic estimate drafting outside the new promotion unless separately extended and verified.
3. If approved to release, apply the proposed migration first, then deploy the reviewed code. The migration adds server-only tables/functions/triggers; it does not modify existing campaigns, pricing, historical invoices or consent rows, seed live coupons, or grant outreach authority.
4. Verify the new read tools, runtime version, real gap/candidate results and signed callback configuration without sending. Unknown/missing customer consent evidence remains an exclusion; the old assumed `existing_customer_terms` rows are not upgraded by scanning. Confirm qualifying records from real consent evidence before marketing contact.
5. Activation remains a separate explicit owner decision: add `outreach:write` to the intended owner grant/token and set `GAP_OUTREACH_ENABLED=true`. No broad campaign permission is implied by code deployment. Keep the existing discount/email engines' settings unchanged unless the owner asks otherwise.
6. Only then preview and approve one exact named batch. Any changed recipient/body/calendar/eligibility needs a fresh preview. No automatic follow-up batch or periodic check-in is configured by this code task.

Rollback for this new workflow: stop pending batches, disable `GAP_OUTREACH_ENABLED` and revoke only the new outreach scope. Preserve the provider/action/redemption ledger for reconciliation; never retry unknown outcomes just because code was rolled back.
