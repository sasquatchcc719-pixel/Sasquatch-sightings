# Twilio SMS Notification Integration Plan

## Context

We are **replacing OneSignal push notifications with Twilio SMS** for the Sasquatch Sightings application. 

### Why the Change?

1. **OneSignal isn't working reliably** - especially on Safari/iPhone (user's primary device)
2. **SMS is more reliable** - works regardless of browser, device, or whether the app is open
3. **Better for partner notifications** - can send texts to partners when they get referrals
4. **User preference** - Chuck prefers SMS for instant alerts

### Current State

- ✅ OneSignal is already integrated (client + server code exists)
- ✅ OneSignal subscription works on desktop Chrome
- ❌ OneSignal notifications NOT appearing (likely Safari/iOS issues)
- ✅ Lead creation works perfectly (contest entries show in Lead Tracker)
- ✅ Server-side notification code is in place but needs to be switched to Twilio

## What Needs to Be Built

### 1. SMS Alerts for Admin (Chuck)

Send SMS to Chuck's phone number when:
- 🏆 **New contest entry** submitted
- 📞 **Missed call** from RingCentral (already has webhook setup)
- 🤝 **New partner referral** created

**Example SMS:**
```
🎯 New Contest Entry
John Smith - (555) 123-4567
Location: Denver, CO
[Link to lead]
```

### 2. SMS Alerts for Partners

Send SMS to partners when they receive a referral:
```
🎉 New Referral!
[Customer Name] mentioned you
We'll be in touch soon
- Sasquatch Carpet Cleaning
```

## Technical Implementation

### Required Environment Variables

Add to Vercel + `.env.local`:

```bash
TWILIO_ACCOUNT_SID=your_account_sid_here
TWILIO_AUTH_TOKEN=your_auth_token_here
TWILIO_PHONE_NUMBER=your_twilio_phone_number
ADMIN_PHONE_NUMBER=chucks_phone_number  # For admin alerts
```

### Files to Create/Modify

#### 1. Create: `src/lib/twilio.ts`

Helper function for sending SMS:

```typescript
import twilio from 'twilio';

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const twilioPhone = process.env.TWILIO_PHONE_NUMBER;
const adminPhone = process.env.ADMIN_PHONE_NUMBER;

const client = twilio(accountSid, authToken);

export async function sendAdminSMS(message: string): Promise<void> {
  if (!accountSid || !authToken || !twilioPhone || !adminPhone) {
    console.warn('Twilio credentials not configured');
    return;
  }

  try {
    await client.messages.create({
      body: message,
      from: twilioPhone,
      to: adminPhone,
    });
    console.log('Admin SMS sent successfully');
  } catch (error) {
    console.error('Failed to send admin SMS:', error);
  }
}

export async function sendPartnerSMS(
  partnerPhone: string,
  message: string
): Promise<void> {
  if (!accountSid || !authToken || !twilioPhone) {
    console.warn('Twilio credentials not configured');
    return;
  }

  try {
    await client.messages.create({
      body: message,
      from: twilioPhone,
      to: partnerPhone,
    });
    console.log(`Partner SMS sent to ${partnerPhone}`);
  } catch (error) {
    console.error('Failed to send partner SMS:', error);
  }
}
```

#### 2. Modify: `src/app/api/sightings/route.ts`

Replace OneSignal call (line ~216) with Twilio:

```typescript
import { sendAdminSMS } from '@/lib/twilio'

// Replace the sendOneSignalNotification call with:
await sendAdminSMS(
  `🏆 New Contest Entry\n${fullName} - ${phoneNumber}\n${locationText || city || 'Unknown location'}`
)
```

#### 3. Modify: `src/app/api/leads/route.ts`

For missed calls from RingCentral (line ~80-90):

```typescript
await sendAdminSMS(
  `📞 Missed Call\n${name || 'Unknown'} - ${formatPhoneDisplay(phone)}`
)
```

#### 4. Modify: `src/app/api/admin/referrals/route.ts`

For partner referrals (add SMS to both admin AND partner):

```typescript
import { sendAdminSMS, sendPartnerSMS } from '@/lib/twilio'

// After lead creation, send to admin:
await sendAdminSMS(
  `🤝 New Partner Referral\n${name} - ${formatPhoneDisplay(phone)}\nReferred by: ${partner.name}`
)

// Also notify the partner:
if (partner.phone) {
  await sendPartnerSMS(
    partner.phone,
    `🎉 New Referral!\n${name} mentioned you as their preferred partner.\nWe'll be in touch soon!\n- Sasquatch Carpet Cleaning`
  )
}
```

### Dependencies

Install Twilio SDK:

```bash
npm install twilio
```

## Setup Steps

### 1. Twilio Account Setup

If Chuck doesn't have a Twilio account:

1. Go to https://www.twilio.com/try-twilio
2. Sign up for free trial (gives $15 credit)
3. Verify Chuck's phone number during signup
4. Get a Twilio phone number (free with trial)
5. Copy credentials from console:
   - Account SID
   - Auth Token
   - Twilio Phone Number

### 2. Configuration

1. Add environment variables to Vercel (Settings → Environment Variables)
2. Add same variables to local `.env.local`
3. Mark all variables for: Production, Preview, Development

### 3. Testing

1. Submit a contest entry
2. Check if Chuck receives SMS
3. Create a partner referral (test partner SMS if partner has phone number)
4. Trigger a missed call webhook (if RingCentral is set up)

## What to Do with OneSignal

### Option 1: Remove Completely

- Delete `src/components/onesignal-init.tsx`
- Remove from `src/app/admin/layout.tsx`
- Delete `src/lib/onesignal.ts`
- Remove env vars: `ONESIGNAL_APP_ID`, `ONESIGNAL_API_KEY`

### Option 2: Keep as Backup (Recommended)

- Leave OneSignal code in place
- Keep it in admin layout for desktop users
- Add SMS alongside it (both will fire)
- Desktop users get visual notification + Chuck gets SMS

## Current File Locations

**Existing files that reference OneSignal:**
- `src/lib/onesignal.ts` - Server-side OneSignal API calls
- `src/components/onesignal-init.tsx` - Client-side OneSignal SDK
- `src/app/admin/layout.tsx` - Loads OneSignalInit component
- `src/app/api/sightings/route.ts` - Calls sendOneSignalNotification
- `src/app/api/leads/route.ts` - Calls sendOneSignalNotification  
- `src/app/api/admin/referrals/route.ts` - Calls sendOneSignalNotification

**Branch:**
- Feature branch: `feature/onesignal-admin-notifications` (merged to main)
- Currently on: `main` branch

## Important Notes

- Chuck's primary device is **iPhone with Safari** (OneSignal doesn't work well)
- Phone number format in database: stored as `(XXX) XXX-XXXX`
- Partners have optional phone numbers in the `partners` table
- The `leads` table has a unique constraint on phone numbers (duplicates will fail silently)
- Admin phone number needs to be in E.164 format for Twilio: `+1XXXXXXXXXX`

## Testing Checklist

After implementation:

- [ ] Contest entry triggers SMS to admin
- [ ] SMS includes: name, phone, location
- [ ] Partner referral triggers SMS to admin
- [ ] Partner referral triggers SMS to partner
- [ ] Missed call (RingCentral) triggers SMS to admin
- [ ] No errors in Vercel logs
- [ ] Graceful failure if Twilio creds missing

## Questions for Chuck

Before starting:

1. **Do you have a Twilio account?** (YES/NO)
2. **What's your phone number for receiving alerts?** (format: +1XXXXXXXXXX)
3. **Keep OneSignal as backup or remove it?** (KEEP/REMOVE)

## Next Steps

1. Get Twilio credentials from Chuck
2. Install `twilio` npm package
3. Create `src/lib/twilio.ts`
4. Replace OneSignal calls with SMS calls
5. Add environment variables to Vercel
6. Test with real submission
7. Deploy to production

---

**Created:** 2026-01-24  
**Status:** Ready to implement  
**Priority:** High (replaces non-working OneSignal)
