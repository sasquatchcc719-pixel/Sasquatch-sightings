# Main Business Line – AI After-Hours SMS Setup

You’re approved for SMS on the main business line. The app already has the full flow; you only need to point Twilio at it and turn the AI on.

## What’s already built

- **Incoming SMS** → `POST /api/twilio/sms-incoming`
  - Receives the webhook from Twilio (customer text).
- **AI reply** → Uses OpenAI (Harry) to answer. Reply is sent **from the number they texted** so the thread stays correct (main line vs 866).
- **Conversation in DB** → Finds or creates a row in `conversations` (source: `inbound` for generic texts, or vendor/contest if detected). All messages are stored.
- **Lead creation** → When the bot has first+last name, email, and full address, it creates a `leads` row and links it to the conversation.
- **Urgent handling** → If the AI response indicates escalation (e.g. “flagging for owner”), it sets the conversation to `escalated` and sends you an admin SMS.
- **Email to you** → Every inbound message (and the AI reply) is emailed to sasquatchcc719@gmail.com.

No code changes are required for this; it’s configuration only.

---

## 1. Twilio Console (main business number)

1. Go to [Twilio Console](https://console.twilio.com) → **Phone Numbers** → **Manage** → **Active Numbers**.
2. Click the **main business line** (the one you just got approved for SMS).
3. Under **Messaging**:
   - **A MESSAGE COMES IN**:  
     - Webhook: `https://sightings.sasquatchcarpet.com/api/twilio/sms-incoming`  
     - Method: **POST**  
   - (If you have “Primary handler fails”, you can leave it blank or point to the same URL.)
4. **Save**.

After this, any SMS to that number will hit your app.

---

## 2. Vercel environment variables

In **Vercel** → your project → **Settings** → **Environment Variables**, ensure:

| Variable | Purpose |
|----------|--------|
| `AI_DISPATCHER_ENABLED` | Set to **`true`** (string). If missing or `false`, the AI will not reply; messages are still stored and you still get email. |
| `OPENAI_API_KEY` | Used for Harry’s replies. Required for AI. |
| `TWILIO_ACCOUNT_SID` | Twilio account. |
| `TWILIO_AUTH_TOKEN` | Twilio auth. |
| `TWILIO_PHONE_NUMBER` | Fallback “from” number for outbound (e.g. contest). Can stay as 866; **replies to the main line use the main line number** from the webhook. |
| `ADMIN_PHONE_NUMBER` | Your phone for escalation/admin SMS. |
| `RESEND_API_KEY` | For email notifications (inbound + AI reply). |

Redeploy after changing env vars.

---

## 3. Optional: use main line as default outbound

If you want **all** outbound SMS (contest, nurture, etc.) to come from the main line, set:

- `TWILIO_PHONE_NUMBER` = main business number (e.g. `+17195551234`).

Replies to inbound SMS already use the number the customer texted, so this only affects **outbound** flows (contest welcome, nurture, etc.).

---

## 4. Test

1. From your cell, send a text to the **main business number** (e.g. “When can you clean my carpet?”).
2. You should get an AI reply from that same number.
3. Check:
   - **Admin → Conversations** for the new conversation (source “inbound”).
   - Your email for the “New Text Message Received” with customer message + “Harry replied”.
4. If the AI says it’s escalating, you should get an admin SMS.

If you don’t get a reply:

- Confirm **A MESSAGE COMES IN** points to `https://sightings.sasquatchcarpet.com/api/twilio/sms-incoming` (POST).
- Confirm `AI_DISPATCHER_ENABLED=true` and `OPENAI_API_KEY` are set and you redeployed.
- Check Vercel → **Logs** for the `sms-incoming` route for errors.

---

## Summary

| Step | Action |
|------|--------|
| Twilio | Main line → Messaging → “A MESSAGE COMES IN” → `https://sightings.sasquatchcarpet.com/api/twilio/sms-incoming` (POST). |
| Vercel | `AI_DISPATCHER_ENABLED=true`, `OPENAI_API_KEY` (and Twilio/Resend vars). Redeploy. |
| Test | Text the main line; you should get an AI reply and an email. |

No code changes needed; the existing `/api/twilio/sms-incoming` flow already does AI reply, conversation/lead creation, and urgent notification.
