# Testing Plan - RingCentral + OneSignal Integration

## ✅ Step 1: Test OneSignal Push Notifications

### 1a. Subscribe to Notifications
1. Visit: https://sightings.sasquatchcarpet.com/
2. You should see a browser notification prompt
3. Click **"Allow"**
4. ✅ You're now subscribed!

### 1b. Verify Subscription
1. Go to: https://onesignal.com/
2. Log in → Select your app
3. Go to **"Audience"** → **"All Users"**
4. You should see **1 subscriber** (you)

### 1c. Test Contest Entry Notification
1. Go to: https://sightings.sasquatchcarpet.com/sightings
2. Fill out the contest form:
   - Name: Test User
   - Phone: (719) 555-1234
   - Email: test@example.com
   - Location: "Springs & Academy"
3. Submit (photo optional)
4. **Expected:** Push notification: "🏆 New Contest Entry from Test User"

---

## ✅ Step 2: Test Lead Tracking

### 2a. Verify Contest Lead Created
1. Go to: https://sightings.sasquatchcarpet.com/admin/leads
2. Look for the lead you just created
3. **Expected:**
   - Name: Test User
   - Phone: (719) 555-1234
   - Source: "contest"
   - Status: "new"

### 2b. Test Lead Management
1. Click on the lead card
2. Try changing status: new → contacted
3. Add notes: "Test note"
4. **Expected:** Changes save successfully

---

## ✅ Step 3: Test Partner Referral Notification

### 3a. Create Test Partner (if you don't have one)
1. Go to: https://sightings.sasquatchcarpet.com/partners/register
2. Register a test partner account
3. Log in

### 3b. Submit Referral
1. From partner dashboard, submit a referral
2. Client Name: Test Client
3. Client Phone: (719) 555-5678
4. **Expected:** Push notification: "🤝 New Partner Referral"

### 3c. Verify in Leads
1. Go to: https://sightings.sasquatchcarpet.com/admin/leads
2. Look for the partner referral
3. **Expected:**
   - Name: Test Client
   - Source: "partner"
   - Status: "new"

---

## ⏳ Step 4: Set Up RingCentral Webhook (Not Yet Done)

### Option A: Manual Setup via API Explorer (5 minutes)

1. Go to: https://developers.ringcentral.com/api-reference
2. Log in with: sasquatchcc719@gmail.com
3. Search for: "Create Subscription"
4. Click "Try it out"
5. Paste this JSON:

```json
{
  "eventFilters": [
    "/restapi/v1.0/account/~/extension/~/presence?detailedTelephonyState=true"
  ],
  "deliveryMode": {
    "transportType": "WebHook",
    "address": "https://sightings.sasquatchcarpet.com/api/leads"
  }
}
```

6. Click "Execute"
7. Look for: `"status": "Active"`

### Option B: Manual Guide
```bash
node setup-ringcentral-webhook-manual.js
```

### 4b. Test Missed Call (After Webhook Setup)
1. Call: (719) 749-8807
2. Let it ring without answering
3. **Expected:**
   - SMS received: "Thanks for calling Sasquatch..."
   - Push notification: "📞 Missed Call from [phone]"
   - Lead appears in admin with source: "missed_call"

---

## 🎯 Quick Test Checklist

| Feature | Test | Expected Result | ✓ |
|---------|------|-----------------|---|
| **OneSignal SDK** | Visit site | Notification prompt appears | ☐ |
| **Subscribe** | Click "Allow" | Appears in OneSignal dashboard | ☐ |
| **Contest Entry** | Submit form | Push notification received | ☐ |
| **Contest Lead** | Check /admin/leads | Lead shows source: "contest" | ☐ |
| **Partner Referral** | Submit referral | Push notification received | ☐ |
| **Referral Lead** | Check /admin/leads | Lead shows source: "partner" | ☐ |
| **RingCentral Webhook** | Manual setup | Status: Active | ☐ |
| **Missed Call** | Call & don't answer | SMS + Push + Lead created | ☐ |

---

## 📱 Testing on Mobile

### iOS (Safari)
1. Visit site on iPhone
2. Allow notifications when prompted
3. Submit contest entry
4. Notification appears on lock screen

### Android (Chrome)
1. Visit site on Android
2. Allow notifications when prompted
3. Submit contest entry
4. Notification appears in notification shade

---

## 🐛 Troubleshooting

### No Notification Prompt
- Clear cache and reload
- Check browser notification settings
- Try incognito/private mode

### Push Not Received
- Check OneSignal dashboard for send failures
- Verify ONESIGNAL_API_KEY in Vercel is correct
- Check browser console for errors

### Lead Not Created
- Check Vercel deployment logs
- Verify Supabase connection
- Check API route errors in Vercel

### RingCentral Webhook Failed
- Verify webhook is "Active" in RingCentral
- Check webhook URL is correct
- Test with: `curl -X POST https://sightings.sasquatchcarpet.com/api/leads -H "Content-Type: application/json" -d '{"source":"missed_call","phone":"+17195551234","name":"Test"}'`

---

## ✅ Success Criteria

All features working when:
- ✅ Push notifications received for all lead types
- ✅ Leads appear in admin dashboard
- ✅ Lead tracking and status updates work
- ✅ RingCentral webhook creates missed call leads
- ✅ SMS responses sent automatically

---

**Start with Step 1** - test OneSignal notifications first since that's the easiest to verify!
