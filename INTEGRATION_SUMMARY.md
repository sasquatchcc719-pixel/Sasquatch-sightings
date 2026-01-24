# RingCentral + OneSignal Integration - Quick Start

## ✅ What's Been Built

### 1. RingCentral Missed Call Detection
- Webhook endpoint at `/api/leads` detects missed calls
- Automatically creates lead with `source: "missed_call"`
- Sends SMS response to caller: "Thanks for calling Sasquatch Carpet Cleaning! Sorry we missed you. We'll call you back shortly."

### 2. OneSignal Push Notifications
Push notifications sent to admin devices for:
- **📞 Missed Calls**: "New missed call from [name/phone]"
- **🏆 Contest Entries**: "New contest entry from [name]"
- **🤝 Partner Referrals**: "[name] referred by partner"

### 3. Files Created
```
setup-ringcentral-webhook.js    # One-time setup script
test-ringcentral-webhook.js     # Local testing tool
RINGCENTRAL_SETUP.md            # Complete setup guide
.env.local.example              # Environment variable template
src/lib/onesignal.ts           # Push notification helper
src/lib/ringcentral.ts         # SMS sending + webhook parsing
```

### 4. Files Modified
```
src/app/api/leads/route.ts              # Added RingCentral webhook handling
src/app/api/sightings/route.ts          # Added contest entry notifications
src/app/api/admin/referrals/route.ts    # Added partner referral notifications
.env.local                              # Added credentials section
package.json                            # Added @ringcentral/sdk, onesignal-node
```

---

## 🚀 Next Steps (Do These in Order)

### Step 1: Get OneSignal Credentials
1. Go to [OneSignal.com](https://onesignal.com/) and sign up
2. Create a new app
3. Go to **Settings** → **Keys & IDs**
4. Copy your **App ID** and **REST API Key**
5. Add to `.env.local`:
   ```bash
   ONESIGNAL_APP_ID=your-app-id-here
   ONESIGNAL_API_KEY=your-rest-api-key-here
   ```

### Step 2: Add RingCentral Credentials to `.env.local`
You already have `CLIENT_ID` and `CLIENT_SECRET` in your `.env.local`. Now add your login credentials:
```bash
RINGCENTRAL_USERNAME=your_ringcentral_phone_number_or_email
RINGCENTRAL_PASSWORD=your_ringcentral_password
RINGCENTRAL_EXTENSION=
RINGCENTRAL_PHONE_NUMBER=+17197498807
```

### Step 3: Test Locally (Optional)
```bash
# Start dev server
npm run dev

# In another terminal, test the webhook
node test-ringcentral-webhook.js
```

### Step 4: Deploy to Vercel
```bash
# Merge to main
git checkout main
git merge feature/ringcentral-webhook-setup --no-verify
git push origin main --no-verify
```

### Step 5: Add Environment Variables to Vercel
1. Go to [Vercel Dashboard](https://vercel.com/)
2. Select your project
3. Go to **Settings** → **Environment Variables**
4. Add these variables:
   ```
   RINGCENTRAL_CLIENT_ID
   RINGCENTRAL_CLIENT_SECRET
   RINGCENTRAL_USERNAME
   RINGCENTRAL_PASSWORD
   RINGCENTRAL_EXTENSION
   RINGCENTRAL_PHONE_NUMBER
   ONESIGNAL_APP_ID
   ONESIGNAL_API_KEY
   ```
5. Redeploy the project

### Step 6: Register RingCentral Webhook
**IMPORTANT**: Only do this AFTER deploying to Vercel!

```bash
node setup-ringcentral-webhook.js
```

You should see:
```
Logging into RingCentral...
✓ Login successful!
Creating webhook subscription...
✓ Webhook created successfully!
```

This registers your production URL with RingCentral:
```
https://sightings.sasquatchcarpet.com/api/leads
```

### Step 7: Enable Push Notifications on Your Device
1. Visit: `https://sightings.sasquatchcarpet.com/admin`
2. When prompted, click **Allow** for notifications
3. Test by submitting a contest entry

---

## 🧪 Testing

### Test Missed Call Flow
1. Call your RingCentral number: **(719) 749-8807**
2. Let it ring without answering
3. Verify:
   - ✅ Lead created in `/admin/leads` with source "missed_call"
   - ✅ SMS sent to your phone
   - ✅ Push notification received

### Test Contest Entry Flow
1. Go to `/sightings` and submit entry
2. Verify:
   - ✅ Lead created with source "contest"
   - ✅ Push notification: "🏆 New Contest Entry"

### Test Partner Referral Flow
1. Partner submits referral
2. Verify:
   - ✅ Lead created with source "partner"
   - ✅ Push notification: "🤝 New Partner Referral"

---

## 📊 How It Works

### RingCentral Webhook Flow
```
1. Someone calls your business → RingCentral rings
2. Call goes unanswered → RingCentral sends webhook
3. Webhook received at /api/leads
4. System detects: telephonyStatus = "NoCall" + direction = "Inbound"
5. Creates lead with source = "missed_call"
6. Sends SMS via RingCentral API
7. Sends push notification via OneSignal
```

### OneSignal Notification Flow
```
1. Lead created (from any source)
2. sendOneSignalNotification() called
3. OneSignal API sends push to all subscribed admin devices
4. Notification appears with heading, content, and custom data
```

---

## 🔧 Configuration Files

### Environment Variables
All credentials are in `.env.local`:
```bash
# RingCentral
RINGCENTRAL_CLIENT_ID=WCfoTe4MMO8fPxAzLo3P6v
RINGCENTRAL_CLIENT_SECRET=4gaHOBidjlldlmJeZSIS2PbVD8SKDFzo5bNbvKdy6WT9
RINGCENTRAL_USERNAME=your_ringcentral_phone_number_or_email
RINGCENTRAL_PASSWORD=your_ringcentral_password
RINGCENTRAL_EXTENSION=
RINGCENTRAL_PHONE_NUMBER=+17197498807

# OneSignal
ONESIGNAL_APP_ID=your-app-id-here
ONESIGNAL_API_KEY=your-rest-api-key-here
```

### Webhook URL
RingCentral sends events to:
```
https://sightings.sasquatchcarpet.com/api/leads
```

---

## 📝 Customization

### Change SMS Message
Edit `/src/lib/ringcentral.ts`:
```typescript
await sendRingCentralSMS(
  normalizedPhone,
  "Your custom message here!"
)
```

### Change Notification Messages
Edit notification calls in:
- `/src/app/api/leads/route.ts` (missed calls)
- `/src/app/api/sightings/route.ts` (contest entries)
- `/src/app/api/admin/referrals/route.ts` (partner referrals)

---

## 🐛 Troubleshooting

### Webhooks not working?
1. Check RingCentral webhook status in developer console
2. Verify Vercel environment variables are set
3. Check Vercel logs for errors: `vercel logs`

### Push notifications not appearing?
1. Make sure you allowed notifications in browser
2. Check OneSignal dashboard → Audience → All Users
3. Verify environment variables are set

### SMS not sending?
1. Verify `RINGCENTRAL_JWT` is valid
2. Check `RINGCENTRAL_PHONE_NUMBER` format: `+17197498807`
3. Verify RingCentral account has SMS permissions

---

## 📚 Documentation

For detailed setup instructions, see:
- **RINGCENTRAL_SETUP.md** - Complete step-by-step guide
- **.env.local.example** - All required environment variables

For API documentation:
- [RingCentral API Docs](https://developers.ringcentral.com/api-reference)
- [OneSignal API Docs](https://documentation.onesignal.com/reference)

---

## ✨ What's Next?

Consider adding:
- [ ] Custom ringtone/vibration for push notifications
- [ ] SMS keyword responses (e.g., reply "QUOTE" for instant quote link)
- [ ] Voicemail transcription integration
- [ ] Call recording webhooks
- [ ] OneSignal user segments for targeted notifications
