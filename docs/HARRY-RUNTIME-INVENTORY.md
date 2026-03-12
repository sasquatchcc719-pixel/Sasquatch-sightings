# Harry Runtime Inventory

This inventory captures current Harry-related runtime behavior before control-plane changes.

## Live SMS Runtime

- Inbound webhook: `src/app/api/twilio/sms-incoming/route.ts`
  - Creates/updates `conversations` by normalized phone + source.
  - Determines channel/source from message content:
    - `inbound` (default)
    - `contest`
    - `vendor`
    - `business_card`
  - AI response path uses `generateAIResponse()` from `src/lib/openai-chat.ts`.
  - Booking guardrails already exist (no booking link unless name + email + full address).
  - Optional slot offer path uses `buildSmsSlotOffer()`.
  - Auto-lead creation when required info exists.
  - Escalation detection and admin alerts via `shouldEscalate()`.

- Missed-call auto SMS: `src/app/api/twilio/call-after-hours/route.ts`
  - Sends a Harry message after missed/after-hours calls.
  - Maintains `conversations` context for follow-up text interactions.

## Prompt/Logic Runtime

- Core dispatcher prompt: `src/lib/openai-chat.ts`
  - Static system prompt with pricing, policy, escalation, and conversation rules.
  - Reads `AI_DISPATCHER_ENABLED` + `OPENAI_API_KEY`.
  - Model: `gpt-4o`.

## Legacy Analyst Runtime (to disable safely)

- Analyst chat API: `src/app/api/analyst/chat/route.ts`
- Analyst history API: `src/app/api/analyst/history/route.ts`
- Analyst targets API: `src/app/api/analyst/targets/route.ts`
- Analyst scan API: `src/app/api/analyst/scan/route.ts`
- Analyst UI:
  - `src/app/admin/analyst/page.tsx`
  - `src/app/admin/analyst/targets/page.tsx`

## Existing Channel/Source Labels in Conversations

- `inbound`
- `Contest`
- `NFC Card`
- `Business Card`

## Safety Commitments for Control Rollout

- Keep existing behavior ON by default.
- Add explicit toggles around each runtime function.
- Disable Analyst via gates, not data deletion.
- Keep all provider keys unchanged.
