# Commercial customer journey audit — September 4, 2026

This is a code-path and UI review, not proof that a real customer has completed every step. No real request, signature, invoice, or invitation was submitted during this review.

## Customer journey

1. Charles creates a portal contact and shares the login URL, email, and temporary password. The customer sets a new password on first login. Creating access does not send an invitation automatically.
2. The overview identifies the next action. Published agreements can be reviewed, downloaded, and sent back with requested changes. Only an authorized signer can sign. Draft agreements remain private.
3. The service list retains agreement-specific pricing and also offers tile/grout, upholstery, and auto scrubbing when absent from the agreement. Extra services require a separate quote. No service request edits the contract.
4. “Request this service” opens a prefilled request. The customer chooses one-time, weekly, fortnightly, monthly, quarterly, six-monthly, yearly, custom/seasonal, or help choosing. They can give a first preferred date, access window, area/furniture counts, and notes. Different service frequencies use separate requests.
5. Requests become pending records and trigger the existing staff Telegram notification attempt. Charles reviews them in Client requests and records a reply/decision. Approving alone does not reserve a time or generate visits.
6. Charles applies the agreed work through Operations. Agreement-linked recurring plans require a signed agreement with recurring scope lines; plans are saved paused and must be activated. Customers see generated appointments and plans in Schedule & requests.
7. Customers can refresh appointments and replies, review the selected visit, add crew notes, and request changes. Signed-contract cancellation buttons now open a request with the selected visit attached. Existing direct-skip behavior remains for clients without signed contracts. The interface requests 24 hours’ notice.
8. Monthly billing runs through the existing Operations/QuickBooks workflow. New commercial plans now default to monthly consolidation. The customer-level monthly generator includes monthly recurring templates plus one-off visits explicitly tagged for batch billing.

## Corrections in this change

- Tile and upholstery no longer disappear when an agreement supplies its own service cards; matching services are not duplicated.
- Frequency is an explicit selector, with custom/seasonal detail and a visible request summary. Structured service requests no longer require redundant free-text notes.
- Request success persists until dismissed; it tells the customer where to look for replies and confirmed dates.
- Appointment/reply refresh reports failure instead of silently leaving stale data.
- Signed-contract cancellation opens the correct request path instead of hitting a deliberately rejected direct-skip endpoint.
- New commercial recurring plans default to monthly billing.
- Preview wording describes its limits: service-request simulation is available; signing and profile edits remain disabled.

## Remaining gaps and operational dependencies

| Area | Current limitation | Practical impact / next work |
| --- | --- | --- |
| Invitation | Contact creation returns credentials for Charles to share; no automatic invitation. | Customer access still needs a named contact and correct email. Do not send the admin preview URL. |
| Customer notifications | Admin replies/status changes are recorded in the portal, without an automatic customer email/SMS in the request-resolution route. | Charles must contact the customer or ask them to check the portal. Add reliable notifications with delivery/error handling before promising proactive updates. |
| Request conversation | Request record has an initial message and one admin-reply field, not a conversation thread. | Further negotiation uses another request or direct communication; a threaded exchange would improve complex scope discussions. |
| Recurring setup | Customer frequency is a preference, not automatic scheduling. Saltgrass maintenance was optional, not recurring, in the reviewed agreement. | Confirm scope/frequency, publish any necessary revision, obtain acceptance, then create/activate the plan. Do not silently convert optional prices into commitments. |
| Appointment access | No customer live availability picker or instant booking for commercial work. | Customer asks for dates; Charles confirms and schedules. Copy must preserve this distinction. |
| Invoices | No customer invoice list/payment history in the commercial portal. | Billing still relies on the existing invoice/QuickBooks delivery workflow. Portal invoice history is separate unfinished work. |
| Monthly coverage | One-off visits must carry the batch-billing customer tag; existing per-visit plans are not converted by the new default. | Check the initial clean and any add-on visits when scheduling so they enter the intended monthly invoice. |
| Preview coverage | Service requests can be simulated; the staff preview still is not the complete authenticated customer session. | First-login/password change, signing, and real customer authorization need a dedicated test account/fixture for a full browser test. |

## Verification

Targeted component/API tests cover service visibility alongside a published agreement, no scope mutation, custom-frequency/date payloads, missing custom-frequency validation, preview submissions making no API calls, and cancellation opening the correct visit-linked form. Production browser checks cover the visible service cards and frequency form; they do not submit real business records.
