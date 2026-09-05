# Commercial customer journey audit — September 4, 2026

This is a code-path and UI review, not proof that a real customer has completed every step. No real request, signature, invoice, or invitation was submitted during this review.

## Customer journey

1. Charles creates a portal contact and shares the login URL, email, and temporary password. The customer sets a new password on first login. Creating access does not send an invitation automatically.
2. The overview identifies the next action. Published agreements can be reviewed, downloaded, and sent back with requested changes. Only an authorized signer can sign. Draft agreements remain private.
3. The service list retains agreement-specific pricing and shows tile/grout, upholstery, and auto scrubbing as informational capabilities. Additional work and schedule changes are handled by phone or text.
4. A customer reviewing a published agreement can send an agreement-linked note instead of signing. The note is saved and triggers the existing staff Telegram notification attempt; the customer sees whether Telegram delivery was confirmed.
5. Charles reviews agreement notes in Operations, publishes a revised version when needed, and the customer signs only when the terms are correct.
6. Charles applies the agreed work through Operations. Agreement-linked recurring plans require a signed agreement with recurring scope lines; plans are saved paused and must be activated. Customers see generated appointments and plans in Schedule.
7. Customers can refresh appointments, review the selected visit, and add crew notes. The portal directs them to call or text Sasquatch for additional work, cancellations, or rescheduling and requests 24 hours’ notice.
8. Monthly billing runs through the existing Operations/QuickBooks workflow. New commercial plans now default to monthly consolidation. The customer-level monthly generator includes monthly recurring templates plus one-off visits explicitly tagged for batch billing.

## Corrections in this change

- Tile and upholstery do not disappear when an agreement supplies its own service cards; matching services are not duplicated.
- Additional-work and schedule-change forms were removed from the portal in favor of direct phone/text contact.
- Agreement notes remain version-linked, saved for staff review, and alert Charles through Telegram.
- Appointment refresh reports failure instead of silently leaving stale data.
- New commercial recurring plans default to monthly billing.
- Preview wording describes its limits: signing, profile edits, and agreement notes remain disabled.

## Remaining gaps and operational dependencies

| Area                | Current limitation                                                                                                       | Practical impact / next work                                                                                                                          |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Invitation          | Contact creation returns credentials for Charles to share; no automatic invitation.                                      | Customer access still needs a named contact and correct email. Do not send the admin preview URL.                                                     |
| Agreement follow-up | An agreement note alerts Charles, but staff responses are handled by phone/text or by publishing a revised agreement.    | This is intentional: the portal is not a general-purpose conversation or booking system.                                                              |
| Recurring setup     | Recurring dates are configured by staff after the agreement is signed.                                                   | Confirm scope/frequency, publish any necessary revision, obtain acceptance, then create and activate the plan.                                        |
| Appointment access  | Customers view confirmed appointments but do not directly book or change them in the portal.                             | Additional work, cancellations, and rescheduling are handled by phone or text.                                                                        |
| Invoices            | No customer invoice list/payment history in the commercial portal.                                                       | Billing still relies on the existing invoice/QuickBooks delivery workflow. Portal invoice history is separate unfinished work.                        |
| Monthly coverage    | One-off visits must carry the batch-billing customer tag; existing per-visit plans are not converted by the new default. | Check the initial clean and any add-on visits when scheduling so they enter the intended monthly invoice.                                             |
| Preview coverage    | Staff preview is read-only and is not the complete authenticated customer session.                                       | First-login/password change, agreement notes, signing, and real customer authorization need a dedicated test account/fixture for a full browser test. |

## Verification

Targeted component/API tests cover informational service visibility, agreement-linked notes, Telegram delivery reporting, rejected additional-work submissions, signing safeguards, read-only staff preview, and direct phone/text scheduling guidance. They do not submit real business records.

## Request inbox follow-up

The Commercial accounts page keeps an Agreement notes inbox visible when empty and links to it from each commercial workspace. Real agreement-note alerts include a direct record anchor and are capped below Telegram's message limit. A failed Telegram result gets one retry and an explicit log with the saved note ID; this is not a durable background retry queue.
