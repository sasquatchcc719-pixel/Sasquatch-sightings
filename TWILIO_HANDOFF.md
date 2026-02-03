# Twilio Voice Setup - Handoff Summary

## Current Status: Voice Endpoints Deployed and Working

The code is deployed to Vercel and working. The call routing endpoint was tested successfully.

---

## Critical Discovery: Domain Issue

**`sasquatchsightings.com` is NOT pointing to Vercel.** It's going through GoDaddy and returning 405 errors.

**The correct working URL is:**
```
https://sasquatch-sightings-git-main-charles-sewells-projects.vercel.app
```

All Twilio webhooks must use this Vercel URL, NOT sasquatchsightings.com.

---

## Deployed Endpoints

### 1. Call Router (Voice Webhook)
**URL:** `https://sasquatch-sightings-git-main-charles-sewells-projects.vercel.app/api/twilio/call-router`

**What it does:**
- Checks current time in Mountain Time (America/Denver)
- **Business Hours (Mon-Fri 9AM-5PM MT):** Dials both SIP endpoints simultaneously with 20s timeout
- **After Hours:** Plays message and triggers Harry SMS

**Business Hours TwiML:**
```xml
<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial timeout="20" action="https://sasquatch-sightings-git-main-charles-sewells-projects.vercel.app/api/twilio/call-after-hours">
    <Sip>sip:chuck@sasquatch-cc.sip.us1.twilio.com</Sip>
    <Sip>sip:wife@sasquatch-cc.sip.us1.twilio.com</Sip>
  </Dial>
</Response>
```

**After Hours TwiML:**
```xml
<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Thanks for calling Sasquatch Carpet Cleaning. Our office hours are closed, but you should be receiving a text from Harry shortly.</Say>
  <Redirect method="POST">https://sasquatch-sightings-git-main-charles-sewells-projects.vercel.app/api/twilio/call-after-hours</Redirect>
</Response>
```

### 2. Call After Hours (Missed Call Handler)
**URL:** `https://sasquatch-sightings-git-main-charles-sewells-projects.vercel.app/api/twilio/call-after-hours`

**What it does:**
- Triggered when call is missed (no-answer, busy, failed) OR after hours
- Creates/updates conversation in database
- Sends Harry SMS: "Hi! This is Harry from Sasquatch Carpet Cleaning. I saw you just called. How can I help you today?"
- Logs to sms_logs table
- Only sends SMS if call was actually missed (checks DialCallStatus)

### 3. SMS Incoming (Already Existed)
**URL:** `https://sasquatch-sightings-git-main-charles-sewells-projects.vercel.app/api/twilio/sms-incoming`

**What it does:**
- Receives inbound SMS from customers
- AI dispatcher responds using OpenAI
- Tracks conversations in database
- Creates leads when enough info collected

---

## Twilio Console Configuration Needed

### Phone Number: +1 719-249-8791

#### Voice Configuration
- **A call comes in:** Webhook
- **URL:** `https://sasquatch-sightings-git-main-charles-sewells-projects.vercel.app/api/twilio/call-router`
- **HTTP Method:** POST

#### Messaging Configuration
- **A message comes in:** Webhook
- **URL:** `https://sasquatch-sightings-git-main-charles-sewells-projects.vercel.app/api/twilio/sms-incoming`
- **HTTP Method:** POST

---

## SIP Domain Configuration

**Domain:** `sasquatch-cc.sip.us1.twilio.com`

**SIP Endpoints:**
- `chuck` - Chuck's Zoiper
- `wife` - Wife's Zoiper

Make sure:
1. SIP domain exists in Twilio Console → Voice → SIP Domains
2. Credential lists are configured for chuck and wife
3. Zoiper apps are registered to these credentials

---

## Environment Variables Required

These should already be in Vercel:
```
TWILIO_ACCOUNT_SID=xxx
TWILIO_AUTH_TOKEN=xxx
TWILIO_PHONE_NUMBER=+17192498791
NEXT_PUBLIC_SUPABASE_URL=xxx
SUPABASE_SERVICE_ROLE_KEY=xxx
```

---

## Testing Checklist

1. [ ] Configure Twilio phone number voice webhook to call-router URL
2. [ ] Configure Twilio phone number SMS webhook to sms-incoming URL
3. [ ] Test call during business hours → Should ring both Zoiper apps
4. [ ] Test call after hours → Should play message and send SMS
5. [ ] Test missed call → Should send Harry SMS
6. [ ] Test inbound SMS → Should get AI response
7. [ ] Check Vercel logs for any errors

---

## Files Modified Today

```
src/app/api/twilio/call-router/route.ts     # NEW - Voice routing logic
src/app/api/twilio/call-after-hours/route.ts # NEW - Missed call SMS handler
src/app/links/page.tsx                       # NEW - Review/share page
src/app/r/page.tsx                           # NEW - Short URL redirect
TWILIO_CURRENT_STATE.md                      # Documentation
```

---

## Known Issues

1. **sasquatchsightings.com domain** - Not pointing to Vercel. Either:
   - Fix DNS to point to Vercel
   - Or continue using the .vercel.app URL for webhooks

2. **SIP may need verification** - The SIP endpoints `chuck@sasquatch-cc.sip.us1.twilio.com` and `wife@sasquatch-cc.sip.us1.twilio.com` need to be properly configured in Twilio SIP Domains with credentials that match what's in Zoiper.

---

## Next Steps for Claude

1. Help configure Twilio Console with the correct webhook URLs
2. Verify SIP domain and credential setup
3. Test the full call flow
4. Troubleshoot any issues that come up during testing
