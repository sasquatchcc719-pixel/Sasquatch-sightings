# Commercial accounts

Operations → Commercial Accounts (`/admin/operations/commercial`) is the account workspace. Client contacts continue using `/client` with their existing customer-scoped login.

## Workflow

1. Create the business and its addresses in Customers, or search an existing business in Commercial Accounts. Saving its profile, creating its agreement, or creating a login marks it commercial.
2. Import an accepted estimate or start a draft. Imported line items preserve measured quantities, units, dimensions, section measurements, rates, and scope notes. Initial, recurring, and optional services are separate; optional prices are not added to the initial scope total.
3. Confirm the client's legal business name, service location, start/end dates, methods, frequencies, payment and cancellation terms, and Sasquatch's approving representative. Review the starter language for the actual engagement. It is not a lawyer-reviewed contract.
4. Save the draft. Publishing freezes its terms and exposes that version to the customer's portal. Publishing does not send an email or text. Withdraw an unsigned published version if it should no longer be accepted.
5. Create a contact login and share its one-time temporary password manually. Explicitly enable **Can sign agreements** for authorized signers. Existing contacts initially retain schedule access but have signing permission off. They must set their own password before signing.
6. The client reviews the exact published version, enters name/title/password, and affirmatively consents to electronic signing. The server validates their account, signing permission, fresh password, customer ownership, content fingerprint, and version. Signature details and the signed record are immutable. Both parties can download a self-contained HTML copy or open the printable document and use their browser's Print / Save as PDF.
7. For initial work, open the source estimate and use the existing schedule/convert workflow. For ongoing work, select recurring lines from a signed agreement, set the actual timing and billing mode, preview dates, and save a paused plan. Separate plans support different methods, frequencies, and date-bounded seasons. Activate and generate visits explicitly. Existing calendar conflict checks remain in effect; review skipped dates in the result. Recurring measurements now survive into generated job lines.
8. Clients can update billing/access preferences and request service types, work areas, dates, time windows, frequencies, scope changes, and cancellations. Requests go to the existing admin review panel and Telegram. Approval records the decision; apply the scheduling change with Operations' existing tools. It does not imply that a visit has already moved. Accounts with signed agreements must request cancellation rather than using the older unconditional skip path.
9. Changes to published or signed agreements require a new version. Previous signed records remain available. New versions do not silently reprice or replace existing scheduled work: review and update the affected plans explicitly.

## Saltgrass draft

The private draft imported from estimate `4859863a-8983-4ec0-89bf-dadf034b5349` preserves 2,258 square feet at $0.40 plus two hours of content manipulation at $73.37/hour: **$1,049.94**. The $0.35 hot-water extraction and $0.28 VLM rates were in the accepted bid notes and are represented as optional future services. Their frequency is not yet agreed. Payment terms, cancellation terms, effective dates, legal identity confirmation, approving representative, and the customer's signer still need business input before publication. Nothing has been sent, signed, or booked by this setup.

`scripts/seed-saltgrass-commercial.ts` is idempotent and will preserve an existing draft. Run with `NODE_PATH=./node_modules/next/dist/compiled NODE_OPTIONS=--conditions=react-server pnpm exec tsx scripts/seed-saltgrass-commercial.ts` if restoring this setup.

## Security and verification

- Commercial profile/agreement tables use RLS, no public grants, and customer-scoped server APIs. Signature IP/user-agent stay out of customer responses and downloads. Content fingerprint uses canonical JSON so Postgres JSONB key ordering cannot change the hash.
- Database triggers freeze published content and prevent all edits/deletes of signed or withdrawn records. Revision checks prevent signing or saving a stale version. A new version is a separate retained record.
- Service plan and recurrence rule creation is transactional; a request ID makes retries idempotent. Plans start paused and cannot silently reserve calendar slots.
- Staff client previews now render a read-only admin page, rather than minting client sessions. Signing also requires a fresh customer password, including for any legacy preview sessions.
- Unit/API tests: `pnpm exec vitest run src/lib/ops/commercial.test.ts src/app/api/client/commercial`.
- Database assertions: `supabase/tests/commercial_portal.sql`, run inside `BEGIN` / `ROLLBACK`; verifies immutability, revision increments, permissions, and transactional/idempotent paused plans without appointments or communications.
- Electronic record design follows the retention/reproduction and signature-intent principles in [15 USC 7001](https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title15-section7001&num=0&edition=prelim). This describes implementation, not a guarantee of enforceability.

## Boundaries

Each login belongs to one business customer record; multiple contacts and service addresses are supported within that account. A manager responsible for separate customer records needs separate logins today. Uploaded insurance certificates, purchase order documents, automatic price escalation, and automated contract renewal are not part of this workflow.
