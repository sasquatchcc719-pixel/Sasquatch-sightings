# SMS Implementation Plan

## Overview
This document outlines the SMS features we're implementing NOW to improve customer engagement and lead conversion.

---

## 🎯 Core Features (Building Now)

### 1. Contest Entry Auto-Response
**Trigger:** When someone submits a contest entry (sighting)  
**Recipient:** The customer who submitted the entry  
**Message:**
```
Thanks for entering the Sasquatch contest! 🦶
Book your carpet cleaning now and get $20 off:
https://book.housecallpro.com/book/Sasquatch-Carpet-Cleaning-LLC/9841a0d5dee444b48d42e926168cb865?v2=true
Use coupon: Contest20 (add to notes when booking)
Questions? Call (719) 249-8791
```

**Technical Implementation:**
- File: `src/app/api/sightings/route.ts`
- After lead is created, call `sendCustomerSMS(phone, message)`
- New helper function in `src/lib/twilio.ts`

---

### 2. Partner Referral Auto-Response
**Trigger:** When a partner submits a referral  
**Recipient:** The customer being referred  
**Message:**
```
Thanks for reaching out! [Partner Name] recommended us.
Book now or we'll call you within 24 hours:
https://book.housecallpro.com/book/Sasquatch-Carpet-Cleaning-LLC/9841a0d5dee444b48d42e926168cb865?v2=true
- Sasquatch Carpet Cleaning
(719) 249-8791
```

**Technical Implementation:**
- File: `src/app/api/admin/referrals/route.ts`
- After referral is created, fetch partner name
- Call `sendCustomerSMS(client_phone, message)` with partner name inserted
- New helper function in `src/lib/twilio.ts`

---

### 3. Partner Credit Notification
**Trigger:** When a referral's status changes to 'converted'  
**Recipient:** The partner who made the referral  
**Message:**
```
🎉 Referral Converted!
[Client Name] just booked a job!
You earned: $[credit_amount] credit
Your balance: $[actual balance]
Total referrals: [count]
- Sasquatch Carpet Cleaning
```

**Technical Implementation:**
- File: `src/app/api/admin/referrals/route.ts` (PATCH handler)
- When status changes TO 'converted' (and wasn't before)
- Fetch partner info, credit_amount, and updated balance
- Count total converted referrals for that partner
- Call `sendPartnerSMS(partner.phone, message)`
- Already exists, just needs to add this logic

---

### 4. Lead Nurturing Sequence ⭐ THE SILVER BULLET

**Trigger:** Automated daily cron job  
**Recipients:** All leads with status 'new' or 'contacted' who haven't been won/lost  

#### Day 3 After Lead Creation
**Message:**
```
Hi [Name], still need carpet cleaning?
You have $20 off! Use coupon: Contest20 (add to notes)
Book now: https://book.housecallpro.com/book/Sasquatch-Carpet-Cleaning-LLC/9841a0d5dee444b48d42e926168cb865?v2=true
- Sasquatch Carpet Cleaning
(719) 249-8791
```

#### Day 7 After Lead Creation
**Message:**
```
Special offer for [Name]!
Get $25 off when you book this week.
Use coupon: Contest25 (add to notes)
https://book.housecallpro.com/book/Sasquatch-Carpet-Cleaning-LLC/9841a0d5dee444b48d42e926168cb865?v2=true
- Sasquatch Carpet Cleaning
(719) 249-8791
```

#### Day 14 After Lead Creation
**Message:**
```
Last chance, [Name]!
Book this week and get $30 off.
Use coupon: Contest30 (add to notes)
https://book.housecallpro.com/book/Sasquatch-Carpet-Cleaning-LLC/9841a0d5dee444b48d42e926168cb865?v2=true
Reply STOP to unsubscribe
- Sasquatch Carpet Cleaning
(719) 249-8791
```

**Technical Implementation:**

**Option A: Vercel Cron Job (Recommended)**
- Create `src/app/api/cron/nurture-leads/route.ts`
- Add to `vercel.json`:
  ```json
  {
    "crons": [{
      "path": "/api/cron/nurture-leads",
      "schedule": "0 9 * * *"
    }]
  }
  ```
- Runs daily at 9 AM
- Queries leads table for leads created 3, 7, or 14 days ago
- Checks if SMS already sent for that day (need to track this)
- Sends appropriate SMS

**Option B: External Cron (Alternative)**
- Use a service like cron-job.org to hit the endpoint daily
- Same logic as Option A

**Database Changes Needed:**
Add to `leads` table:
```sql
ALTER TABLE leads
ADD COLUMN day_3_sms_sent_at TIMESTAMPTZ,
ADD COLUMN day_7_sms_sent_at TIMESTAMPTZ,
ADD COLUMN day_14_sms_sent_at TIMESTAMPTZ;
```

This tracks when each nurture SMS was sent to prevent duplicates.

---

## 📁 Files to Create/Modify

### New Files:
1. `src/app/api/cron/nurture-leads/route.ts` - Daily cron job for lead nurturing
2. `vercel.json` - Configure cron schedule (if using Vercel Cron)

### Modified Files:
1. `src/lib/twilio.ts` - Add `sendCustomerSMS()` helper function
2. `src/app/api/sightings/route.ts` - Add contest entry auto-response
3. `src/app/api/admin/referrals/route.ts` - Add customer auto-response and improved partner credit notification

### Database Migration:
1. Add SMS tracking columns to `leads` table

---

## 🧪 Testing Plan

### 1. Contest Entry Auto-Response
- Submit a test contest entry with a verified phone number
- Verify SMS received with correct booking link and coupon code
- Check that lead is created in database

### 2. Partner Referral Auto-Response
- Create a test referral via admin panel
- Verify customer receives SMS with partner name and booking link
- Verify admin receives notification (already working)

### 3. Partner Credit Notification
- Create a test referral
- Change status to 'converted'
- Verify partner receives SMS with:
  - Client name
  - Credit amount ($20 or $25)
  - Updated balance
  - Total referral count

### 4. Lead Nurturing
- Manually trigger the cron job endpoint
- Verify it finds leads at Day 3, 7, and 14
- Verify correct SMS is sent for each day
- Verify tracking columns are updated
- Verify no duplicate SMS sent on subsequent runs

---

## 🚀 Deployment Steps

1. **Database Migration**
   - Run SQL migration in Supabase to add tracking columns
   - Verify columns exist in production

2. **Deploy Code**
   - Push feature branch to GitHub
   - Create preview deployment on Vercel
   - Test all 4 features on preview

3. **Configure Cron (if using Vercel Cron)**
   - Ensure `vercel.json` is committed
   - Cron jobs only work in production, not preview
   - Will need to deploy to main to test cron

4. **Verify Environment Variables**
   - All Twilio credentials already in Vercel ✅
   - No new env vars needed

5. **Test in Production**
   - Submit real contest entry
   - Create real referral
   - Wait for cron to run (or manually trigger)

---

## 📊 Success Metrics

After implementation, track:
- **Response rate:** How many leads reply to nurture SMS
- **Booking rate:** How many nurture SMS lead to bookings
- **Partner engagement:** Partner satisfaction with credit notifications
- **Contest conversions:** How many contest entries book jobs

---

## ⏱️ Timeline Estimate

- **Database migration:** 5 minutes
- **Add customer SMS helper:** 15 minutes
- **Contest entry auto-response:** 10 minutes
- **Partner referral auto-response:** 15 minutes
- **Improved partner credit notification:** 20 minutes
- **Lead nurturing cron job:** 45 minutes
- **Testing:** 30 minutes
- **Total:** ~2.5 hours

---

## 🔗 Related Documents

- `SMS_FUTURE_FEATURES.md` - Ideas for later implementation
- `TWILIO_INTEGRATION_PLAN.md` - Original Twilio setup documentation
- `TESTING_PLAN.md` - General testing guidelines
