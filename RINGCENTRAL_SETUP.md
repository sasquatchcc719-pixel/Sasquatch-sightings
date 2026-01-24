# RingCentral + OneSignal Integration Setup Guide

This guide explains how to set up RingCentral webhook integration for missed calls and OneSignal push notifications.

## Overview

When someone calls your business and you miss the call, the system automatically:
1. Creates a lead in the database with source = "missed_call"
2. Sends an SMS back to the caller via RingCentral
3. Sends a push notification to your admin devices via OneSignal

## Prerequisites

- RingCentral account with API access
- OneSignal account
- Your app deployed to Vercel (production URL needed for webhooks)

---

## Part 1: RingCentral Setup

### Step 1: Get RingCentral Credentials

1. Go to [RingCentral Developer Portal](https://developers.ringcentral.com/)
2. Create a new app (or use existing)
3. Note down:
   - **Client ID**: e.g., `WCfoTe4MMO8fPxAzLo3P6v`
   - **Client Secret**: e.g., `4gaHOBidjlldlmJeZSIS2PbVD8SKDFzo5bNbvKdy6WT9`
4. Generate a JWT token for your account

### Step 2: Add Credentials to `.env.local`

```bash
RINGCENTRAL_CLIENT_ID=WCfoTe4MMO8fPxAzLo3P6v
RINGCENTRAL_CLIENT_SECRET=4gaHOBidjlldlmJeZSIS2PbVD8SKDFzo5bNbvKdy6WT9
RINGCENTRAL_JWT=your-jwt-token-here
RINGCENTRAL_PHONE_NUMBER=+17195551234
```

### Step 3: Run the Webhook Setup Script

**IMPORTANT**: Only run this script AFTER deploying to Vercel, because RingCentral needs a publicly accessible webhook URL.

```bash
# Set your JWT token
export RINGCENTRAL_JWT="your-jwt-token-here"

# Run the setup script
node setup-ringcentral-webhook.js
```

This creates a webhook subscription that sends events to:
```
https://sightings.sasquatchcarpet.com/api/leads
```

### Step 4: Verify Webhook is Active

1. Log into [RingCentral Developer Console](https://developers.ringcentral.com/)
2. Go to "Webhooks" → "Subscriptions"
3. You should see an active subscription pointing to your `/api/leads` endpoint

---

## Part 2: OneSignal Setup

### Step 1: Create OneSignal Account

1. Go to [OneSignal.com](https://onesignal.com/)
2. Sign up for a free account
3. Create a new app

### Step 2: Get OneSignal Credentials

1. In OneSignal dashboard, go to **Settings** → **Keys & IDs**
2. Note down:
   - **App ID**: e.g., `a1b2c3d4-e5f6-7890-abcd-ef1234567890`
   - **REST API Key**: e.g., `ZGFkZmFzZGY...` (starts with "REST API Key")

### Step 3: Add Credentials to `.env.local`

```bash
ONESIGNAL_APP_ID=a1b2c3d4-e5f6-7890-abcd-ef1234567890
ONESIGNAL_API_KEY=your-rest-api-key-here
```

### Step 4: Deploy to Vercel

```bash
git add .
git commit -m "Add RingCentral and OneSignal integration"
git push origin feature/ringcentral-webhook-setup
```

Then merge to `main` and deploy.

### Step 5: Install OneSignal on Your Device

1. **For Web Push (Desktop/Mobile Browser)**:
   - Visit your admin dashboard: `https://sightings.sasquatchcarpet.com/admin`
   - OneSignal will prompt you to allow notifications
   - Click "Allow"

2. **For Mobile App** (if you build one later):
   - Follow [OneSignal iOS/Android SDK docs](https://documentation.onesignal.com/)

---

## Part 3: Testing

### Test Missed Call Webhook

1. Call your RingCentral business number
2. Let it ring but don't answer (simulate missed call)
3. Check:
   - Lead appears in `/admin/leads` with source "missed_call"
   - You receive SMS: "Thanks for calling Sasquatch..."
   - Push notification appears on your device

### Test Contest Entry Notification

1. Submit a contest entry at `/sightings`
2. Check:
   - Lead appears in `/admin/leads` with source "contest"
   - Push notification: "🏆 New Contest Entry"

### Test Partner Referral Notification

1. Partner submits a referral
2. Check:
   - Lead appears in `/admin/leads` with source "partner"
   - Push notification: "🤝 New Partner Referral"

---

## Webhook Payload Structure

RingCentral sends webhooks when phone events occur. Here's what the system looks for:

```json
{
  "uuid": "abc123",
  "event": "/restapi/v1.0/account/~/extension/~/presence",
  "timestamp": "2026-01-24T12:00:00Z",
  "subscriptionId": "sub123",
  "body": {
    "extensionId": "123456",
    "telephonyStatus": "NoCall",
    "activeCalls": [
      {
        "id": "call123",
        "direction": "Inbound",
        "from": "+17195551234",
        "fromName": "John Doe",
        "to": "+17197498807",
        "telephonyStatus": "NoCall"
      }
    ]
  }
}
```

**Key Detection Logic**:
- `telephonyStatus === "NoCall"` → Call ended
- `direction === "Inbound"` → Incoming call
- If call ended without being answered → Missed call

---

## Environment Variables Reference

| Variable | Purpose | Where to Get |
|----------|---------|--------------|
| `RINGCENTRAL_CLIENT_ID` | RingCentral app authentication | [Developer Portal](https://developers.ringcentral.com/) |
| `RINGCENTRAL_CLIENT_SECRET` | RingCentral app secret | [Developer Portal](https://developers.ringcentral.com/) |
| `RINGCENTRAL_JWT` | Authentication token | Generated in RingCentral admin |
| `RINGCENTRAL_PHONE_NUMBER` | Your business phone (for SMS sending) | Your RingCentral account |
| `ONESIGNAL_APP_ID` | OneSignal app identifier | [OneSignal Dashboard](https://onesignal.com/) |
| `ONESIGNAL_API_KEY` | OneSignal REST API key | [OneSignal Dashboard](https://onesignal.com/) |

---

## Troubleshooting

### Webhooks Not Working

1. **Check RingCentral webhook status**:
   ```bash
   # TODO: Add script to list active subscriptions
   ```

2. **Check Vercel logs**:
   - Go to Vercel dashboard → Your project → Logs
   - Look for POST requests to `/api/leads`
   - Check for errors

3. **Verify webhook URL is publicly accessible**:
   ```bash
   curl -X POST https://sightings.sasquatchcarpet.com/api/leads \
     -H "Content-Type: application/json" \
     -d '{"source": "missed_call", "phone": "+17195551234", "name": "Test"}'
   ```

### Push Notifications Not Appearing

1. **Check browser permissions**:
   - Make sure notifications are enabled in browser settings
   - Try visiting `/admin` again and re-allowing notifications

2. **Check OneSignal dashboard**:
   - Go to "Audience" → "All Users"
   - Verify your device is subscribed

3. **Check Vercel logs for OneSignal API errors**

### SMS Not Sending

1. **Verify RingCentral credentials are correct**
2. **Check RingCentral phone number format**: Must be E.164 format (e.g., `+17195551234`)
3. **Check RingCentral account SMS permissions**

---

## Next Steps

- [ ] Test missed call flow end-to-end
- [ ] Customize SMS message in `/src/lib/ringcentral.ts`
- [ ] Customize push notification messages in each route
- [ ] Set up OneSignal segments for targeting specific users
- [ ] Consider adding sound/vibration to push notifications

---

## File Structure

```
src/
├── lib/
│   ├── onesignal.ts          # OneSignal notification helper
│   └── ringcentral.ts        # RingCentral SMS + webhook parsing
├── app/api/
│   ├── leads/route.ts        # Handles missed call webhooks + lead creation
│   ├── sightings/route.ts    # Contest entries + notifications
│   └── admin/referrals/route.ts  # Partner referrals + notifications
setup-ringcentral-webhook.js  # One-time setup script
```
