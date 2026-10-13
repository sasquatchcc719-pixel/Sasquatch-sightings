# Harry/Dot incoming-SMS wake plan

Status: design only. No migration, deployment, subscription, Twilio configuration, or live message behavior has been changed.

## Current route and gaps

`POST /api/twilio/sms-incoming` stores inbound SMS/MMS messages and returns empty TwiML, so it does not automatically reply to a customer. Today it forwards alerts before the conversation write, does not validate `X-Twilio-Signature`, and deduplicates by searching a conversation JSON array. That check is not a race-safe, system-wide uniqueness guarantee for Twilio `MessageSid` retries.

These gaps must be closed before the route can generate a trusted wake event:

1. Validate the Twilio signature against the exact externally visible webhook URL and reject invalid requests before side effects.
2. Insert the inbound message into a durable ledger with a unique `MessageSid`; a duplicate delivery must become a no-op.
3. Commit the conversation message before enqueueing any alert or MCP event.
4. Return TwiML promptly. Event delivery runs out of band and never sends a customer reply.

## Supported direct route

Implement MCP Events on the same authenticated MCP service using protocol version `2026-07-28`. Add `server/discover`, `events/list`, `events/subscribe`, and `events/unsubscribe`, with one narrowly scoped event such as `conversation.message.received`.

The subscription flow must authorize the owner, validate the event and filters, validate the HTTPS callback without redirects or private-network access, complete the signed callback challenge, and persist the subscription. Deliver one Standard Webhooks-signed event per request. Use a stable event ID across retries, retry only transient failures, and recheck access when delivering.

The event payload should be minimal: stable event ID, conversation ID, Twilio message SID, received timestamp, channel, and a bounded untrusted-content preview. Harry/Dot retrieves the full record through `get_conversation`. Receipt is an alert, not permission to reply, book, edit, or otherwise mutate business data.

## Required implementation work

- Upgrade the MCP SDK/protocol implementation from the current 1.x transport to MCP 2.0 support.
- Add durable subscription and delivery tables plus the unique inbound-message ledger in one reviewed migration.
- Add authenticated subscription lifecycle handlers and signed, retryable delivery processing.
- Attach event enqueueing only after the inbound-message transaction commits.
- Add fixture tests for signature rejection, duplicate `MessageSid`, persist-before-enqueue ordering, challenge verification, stable delivery IDs, retries, revocation, and no customer reply.
- Deploy to a staged URL, run synthetic-only checks, promote, verify `/mcp/about`, rescan the connector, and have the owner approve the event subscription.

No Twilio webhook URL change is required if this is attached to the existing route. A Gmail-mediated wake is a possible fallback, but adds latency and another delivery boundary; it is not the selected design.
