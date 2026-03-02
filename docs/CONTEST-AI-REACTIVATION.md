# Contest / Vendor SMS + AI Reactivation Checklist

After Twilio approves your toll-free number, use this to turn the contest/vendor AI flow back on and verify it.

## 1. Environment (Vercel + local)

- **`AI_DISPATCHER_ENABLED`** must be `true` (string) for the AI to reply to inbound SMS.
  - In Vercel: Project → Settings → Environment Variables. Set `AI_DISPATCHER_ENABLED=true` for Production (and Preview if you test there). Redeploy after changing.
  - Locally: add to `.env.local`: `AI_DISPATCHER_ENABLED=true`
- **Twilio**
  - `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` must be set.
  - For contest/vendor SMS, set `TWILIO_PHONE_NUMBER` to your **approved toll-free** so outbound messages (welcome, nurture) come from it, e.g. `+18665367148`.
- **OpenAI** (for AI replies): `OPENAI_API_KEY` must be set. If missing, `isAIEnabled()` is false and AI stays off.

## 2. Twilio Console (toll-free number)

- Open [Twilio Console](https://console.twilio.com) → Phone Numbers → Manage → Active Numbers → select your toll-free.
- Under **Messaging Configuration**:
  - **A MESSAGE COMES IN**: Webhook URL = `https://sightings.sasquatchcarpet.com/api/twilio/sms-incoming` (or your production URL). Method: **POST**.
- Save. Inbound SMS to this number will hit your app and trigger the AI when enabled.

## 3. Code paths (no changes required)

- **Contest entry with SMS consent**  
  `POST /api/sightings` with `smsConsent=true`:
  - Sends welcome SMS via `sendCustomerSMS` (from `TWILIO_PHONE_NUMBER`).
  - Creates a `conversations` row with `ai_enabled: true` and `source: 'Contest'`.
- **Inbound SMS**  
  `POST /api/twilio/sms-incoming`:
  - Finds or creates conversation by phone number.
  - If `conversation.ai_enabled && isAIEnabled()` → generates reply via OpenAI and sends it with `sendCustomerSMS`.
  - If AI is disabled → only logs the message and notifies admin (no reply).

So: turning AI back on = set `AI_DISPATCHER_ENABLED=true` and ensure Twilio webhook points at `sms-incoming`.

## 4. Test

1. **Contest + SMS**
   - Enter the contest at `/sightings` or `/location/[partnerId]/contest` and **check the SMS consent box**.
   - Submit. You should get the welcome SMS from your Twilio number and a new row in Admin → Conversations with source "Contest" and AI enabled.
2. **AI reply**
   - From the same phone, reply to the welcome message (e.g. "When can you clean?").
   - You should get an AI reply. If not, check Vercel function logs for the sms-incoming route and confirm `AI_DISPATCHER_ENABLED=true` and `OPENAI_API_KEY` are set.

If the main business line is still in resubmit, keep using the approved toll-free for contest/vendor; point that number’s webhook at `sms-incoming` and use it as `TWILIO_PHONE_NUMBER` for outbound contest SMS.
