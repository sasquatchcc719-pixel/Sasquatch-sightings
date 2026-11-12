# Future missed-call follow-up

## Activation

1. Apply the three missed-call migrations and deploy the matching application build. The migrations record immutable activation times; they do not scan or contact existing calls.
2. Refresh the connected Sightings MCP event catalog if it still exposes only `conversation.message.received`.
3. Create a **separate** `call.missed` subscription with empty params and the owner-authorized prompt. Keep existing Gmail and inbound-SMS subscriptions unchanged.
4. Verify its active subscription record and creation time. No old-call replay or customer test text is part of activation.

Deployment alone is not activation. Subscription creation alone is not proof of customer delivery.

## Authenticated owner-email bridge

Until the connected plugin exposes `call.missed`, the signed live terminal callback also creates one future-only owner-email notice after the same voicemail-settling delay. This is an independent wake-up path, not a fabricated inbound SMS or a substitute MCP event.

- Verified sender: `Sasquatch Carpet Cleaning <noreply@sasquatchcarpet.com>`
- Owner recipient: `sasquatchcc719@gmail.com`
- Exact subject prefix: `Sasquatch missed call:`
- Provider idempotency key: `missed-call-owner-notice-v1/<CallSid>`

The email contains only the real CallSid, original provider start time, finalized time, and real conversation ID. It contains no claimed customer message. The separately filtered Gmail watch must match the authenticated sender, recipient, and subject prefix, then use the email only as a hint. Before any customer action, Harry must match `list_calls`, read the live conversation, and prepare the canonical `missed-call:<CallSid>:v1` preview. The preview returns persisted `missed_call_follow_up_evidence`; a copied or spoofed email body cannot create that evidence.

The one-minute worker waits at least 90 seconds for voicemail callbacks, so normal submission is roughly 90–150 seconds after finalization. Email delivery is not guaranteed: if the signed callback cannot durably enqueue, the endpoint returns HTTP 500 and logs the exact CallSid so Twilio may retry, but the application never scans or backfills historical calls. Provider timeouts and ambiguous/missing provider IDs become terminal `unknown` outcomes and are never retried blindly.

## Event and reply contract

- Only a verified Twilio terminal callback can enqueue this event, after provider reconciliation identifies an inbound `no-answer` call. It includes the exact CallSid and a real conversation ID, never a fabricated inbound message.
- The original provider call start must be at or after subscription creation. A 90-second grace period lets answered-call or voicemail callbacks settle. The existing durable delivery cron retries queued events; it does not poll call logs for contacts.
- Before delivery, preview and execution, current call state is checked again. Late voicemail, answered calls, recordings, opt-outs, blacklist entries, manual mode, owner takeover and recent outgoing handling suppress the reply.
- The assistant must read the exact call and conversation, current owner instructions and relevant cross-channel history before writing. Do not infer a name or service request from an unknown number. No historical scan or catch-up outreach.
- Use text-only `preview_customer_message` / `execute_customer_message`, the supplied conversation ID, and **`missed-call:<call_sid>:v1`** as the idempotency key. Do not substitute another key or channel after suppression.
- A suitable no-context message is: “Hi, this is Harry with Sasquatch Carpet Cleaning. Sorry we missed your call. What can we help you with?” Adapt only to verified context. Continue quote and booking work only within current owner authority.
- Read the actual outgoing conversation message before saying it was sent. A provider accepted outcome is not proof of delivery or reading. Report meaningful sends or blockers once to Charles.

## Shared voicemail deduplication

Both the app-side voicemail responder and the event reply use one durable CallSid claim. Concurrent calls from one phone also serialize. Voicemail recording IDs must map to an actual stored call, and callbacks verify the original inbound provider identity and start time. Existing voicemail transcript emails remain intact.

A `sending` or `unknown` claim blocks repeats indefinitely. Do not clear it, retry blindly, or switch channels. Reconcile with Twilio and stored messages first, then have the owner decide if a correction is needed. The status callback does not currently resolve these claim states automatically.

## Verification

- `vitest run src/lib/mcp src/lib/twilio src/app/api/twilio`
- `node scripts/tests/missed-call-migrations.mjs` uses a disposable network-disabled PostgreSQL 16 container and no production credentials.
- Read-only live checks: exact deployment SHA/version, event catalog, subscription creation/status, future event delivery rows, canonical claim, provider message status and stored conversation message.
- Never manufacture a production call/event or send a test customer text to obtain success evidence.
