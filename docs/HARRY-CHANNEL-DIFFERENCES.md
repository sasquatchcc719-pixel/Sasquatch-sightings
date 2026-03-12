# Harry Channel Differences (Current Baseline)

This file records channel-specific behavior differences so they do not get lost.

## Shared Baseline (All Channels)

- Same core `SYSTEM_PROMPT` from `src/lib/openai-chat.ts`.
- Same hard booking gate in `src/app/api/twilio/sms-incoming/route.ts`:
  - require first + last name, email, full address (street/city/zip) before booking link.
- Same escalation/error pathways and admin notification hooks (subject to toggles).

## Channel-Specific Differences

- `inbound`
  - Direct default lead handling.
  - No partner-vendor assumptions.
  - Standard quote/clarify/booking flow.

- `contest`
  - Source detection from contest wording.
  - Contest-origin conversation path and context.
  - Conversion-focused tone while maintaining booking gate.

- `vendor`
  - Source detection from NFC/location mentions.
  - Partner metadata may include location/coupon context.
  - Higher-intent referral framing.

- `business_card`
  - Source detection for card-like discovery without partner match.
  - Personal card flow (no partner assumptions unless metadata exists).

## Dashboard Mapping

- Profiles are seeded in `harry_logic_profiles` (if empty) with explicit per-channel overrides:
  - `inbound`
  - `contest`
  - `vendor`
  - `business_card`
- These are editable in `/admin/harry/control`.

## Note

If profile override text is later edited, that edited content takes precedence.
