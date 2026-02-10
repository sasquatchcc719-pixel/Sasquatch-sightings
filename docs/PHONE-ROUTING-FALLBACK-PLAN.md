# Phone routing fallback plan

If the current call routing (business hours vs after-hours/voicemail) keeps failing, use this plan. **Do not change anything until there’s a real problem.**

---

## Current setup (as of Feb 2025)

- **Twilio Voice “A call comes in”** → `https://sightings.sasquatchcarpet.com/api/twilio/call-router`
- **Call router** (`src/app/api/twilio/call-router/route.ts`) reads `phone_settings` from Supabase, computes “business hours” in America/Denver, and returns either:
  - **Business hours:** TwiML `<Dial>` to SIP endpoints (phones ring).
  - **After hours:** TwiML `<Redirect>` to `/api/twilio/call-after-hours` (voicemail flow).
- **Admin → Phone Settings** in the app controls hours and days; voicemail and after-hours behavior stay in the app.

---

## When to use this plan

- Calls go to voicemail during set business hours (and it’s not a one-off).
- Call router often times out or returns errors (check Vercel logs).
- You need to reduce dependence on the app being up for the “ring vs voicemail” decision.

---

## Step 1: Quick checks (before changing architecture)

1. **Twilio webhook URL**  
   Phone Numbers → [your number] → Voice. “A call comes in” must be:
   `https://sightings.sasquatchcarpet.com/api/twilio/call-router`  
   Not any `...git-main-...vercel.app` or other preview URL.

2. **Admin → Phone Settings**  
   Confirm business hours start/end and business days match reality. Save if you changed anything.

3. **Vercel logs**  
   For a test call during business hours, look for:
   - `[Call Router] MT Time: ... isBusinessDay: ... isBusinessHours: ...`
   - `[Call Router] Settings: start=... end=... days=...`  
   If `isBusinessHours` is false when it should be true, the issue is either DB data or timezone/parsing (fix in app). If the request never hits the router or times out, consider Step 2.

4. **Vercel / Supabase status**  
   If the app or DB is down, the webhook will fail. Twilio “Primary handler fails” can point to a TwiML Bin that sends the call to voicemail so you don’t lose calls.

---

## Step 2: Move business-hours decision to Twilio (fallback architecture)

If the app-based router keeps misbehaving or you want the “ring vs voicemail” decision to not depend on Vercel/Supabase:

### What moves to Twilio

- **Only the decision:** “Is it business hours right now?”
- Implement this in a **Twilio Function** (runs on Twilio’s servers; no dependency on your app for this step).
- The Function uses **hardcoded or Twilio env config** for:
  - Timezone: `America/Denver`
  - Business hours: e.g. 9–17 (9 AM–5 PM)
  - Business days: e.g. Monday–Friday
- The Function returns TwiML:
  - **If business hours:** `<Dial>` to your SIP endpoints (same as now), with `action` pointing to your app’s after-hours URL (for no-answer/busy).
  - **If after hours:** `<Redirect>` to your app’s existing `https://sightings.sasquatchcarpet.com/api/twilio/call-after-hours`.

### What stays in your app

- **Voicemail flow** – `call-after-hours` and voicemail recording, transcription, email, SMS to caller.
- **SMS (incoming and bot)** – No change. Bot can still send texts after hours; A2P approval applies the same.
- **Admin UI** – Phone Settings can remain for voicemail message, SIP list, etc.; only the “live” business-hours check for **calls** would live in Twilio (optional: keep admin hours in sync with Twilio Function config for display only, or document the Twilio values as source of truth).

### Implementation outline (when you decide to do it)

1. In Twilio Console: **Develop** → **Functions & Assets** → create a new Function (e.g. “Call Router”).
2. Function receives the same incoming-call webhook payload. No DB or external API call.
3. In the Function code:
   - Get current time in `America/Denver` (JavaScript `Intl` or a small date lib).
   - Compare to hardcoded or env: `business_hours_start`, `business_hours_end`, `business_days`.
   - If business hours: return TwiML with `<Dial timeout="20" action="https://sightings.sasquatchcarpet.com/api/twilio/call-after-hours">` and your `<Sip>` endpoints.
   - If after hours: return TwiML with `<Redirect method="POST">https://sightings.sasquatchcarpet.com/api/twilio/call-after-hours</Redirect>`.
4. Point the phone number’s **Voice “A call comes in”** to this Twilio Function URL instead of your app’s call-router.
5. Leave **Messaging** webhook pointing at your app (`/api/twilio/sms-incoming`).

### After the move

- Ring vs voicemail no longer depends on Vercel or Supabase.
- To change hours/days, edit the Twilio Function (or its env) and redeploy; document that in this file or in Admin so the team knows where to look.

---

## Emergency: “Always voicemail” TwiML Bin

If the app is down and you need calls to always go to voicemail until things are fixed:

1. Twilio Console → **Develop** → **TwiML Bins** → create a Bin that contains only a redirect to your after-hours URL, e.g.:
   ```xml
   <?xml version="1.0" encoding="UTF-8"?>
   <Response>
     <Redirect method="POST">https://sightings.sasquatchcarpet.com/api/twilio/call-after-hours</Redirect>
   </Response>
   ```
2. On the phone number, set **Primary handler fails** (or temporarily **A call comes in**) to this TwiML Bin so every call goes to that redirect. When the app is back, point “A call comes in” back to the normal router (app or Twilio Function).

---

## Summary

| Scenario | Action |
|----------|--------|
| Occasional wrong behavior | Check Twilio URL, Phone Settings, Vercel logs (Step 1). |
| Persistent wrong hours / timeouts | Consider moving business-hours logic to a Twilio Function (Step 2). |
| App or DB down | Use “Primary handler fails” or temporary “A call comes in” → TwiML Bin redirect to call-after-hours (Emergency). |

SMS and after-hours bot behavior are unchanged by moving the call-routing decision to Twilio.
