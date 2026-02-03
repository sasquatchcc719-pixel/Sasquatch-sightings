# Sasquatch Sightings - Twilio/SMS System Documentation

## Overview

This document describes the complete SMS/Twilio infrastructure for the Sasquatch Sightings application. Use this to understand what's already built before making configuration decisions.

**Business:** Sasquatch Carpet Cleaning (Monument, Colorado)
**Phone Number:** 719-249-8791 (just ported from RingCentral to Twilio)
**App URL:** https://sasquatchsightings.com
**Framework:** Next.js 14 (App Router) + Supabase + Vercel

---

## Environment Variables Required

```bash
# Twilio
TWILIO_ACCOUNT_SID=your_account_sid
TWILIO_AUTH_TOKEN=your_auth_token
TWILIO_PHONE_NUMBER=+17192498791  # The ported number

# Admin alerts
ADMIN_PHONE_NUMBER=+1XXXXXXXXXX  # Chuck's cell for alerts

# AI Dispatcher
OPENAI_API_KEY=your_openai_key
AI_DISPATCHER_ENABLED=true  # Set to 'true' to enable AI responses

# Cron job auth
CRON_SECRET=your_cron_secret
```

---

## Twilio Webhook Configuration Needed

In Twilio Console → Phone Numbers → +17192498791 → Messaging Configuration:

**When a message comes in:**
- Webhook URL: `https://sasquatchsightings.com/api/twilio/sms-incoming`
- HTTP Method: `POST`

---

## Database Schema

### conversations
Stores SMS conversation history for AI context.

```sql
CREATE TABLE conversations (
  id UUID PRIMARY KEY,
  phone_number TEXT NOT NULL,
  source TEXT,                    -- 'inbound', 'NFC Card', 'Business Card', 'Contest'
  lead_id UUID REFERENCES leads(id),
  messages JSONB DEFAULT '[]',    -- Array of {role, content, timestamp, twilio_sid}
  ai_enabled BOOLEAN DEFAULT true,
  status TEXT DEFAULT 'active',   -- 'active', 'completed', 'escalated'
  metadata JSONB,                 -- Partner info: {partner_id, partner_name, coupon_code}
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
);
```

### sms_logs
Tracks all outbound SMS for auditing and debugging.

```sql
CREATE TABLE sms_logs (
  id UUID PRIMARY KEY,
  lead_id UUID REFERENCES leads(id),
  partner_id UUID REFERENCES partners(id),
  recipient_phone TEXT NOT NULL,
  message_type TEXT NOT NULL,     -- See types below
  message_content TEXT NOT NULL,
  status TEXT DEFAULT 'sent',     -- 'sent', 'failed', 'delivered'
  twilio_sid TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ
);
```

**Message Types:**
- `contest_entry` - New contest submission
- `day_3_nurture` - 3-day follow-up
- `day_7_nurture` - 7-day follow-up
- `day_14_nurture` - 14-day follow-up
- `partner_referral` - Partner notification
- `partner_credit` - Partner credit notification
- `admin_alert` - Alert to Chuck
- `ai_dispatcher` - AI response to customer
- `ai_dispatcher_inbound` - Incoming message notification
- `ai_dispatcher_escalation` - Escalation alert
- `customer_notification` - General customer message

### leads table (SMS-related columns)
```sql
-- Nurture tracking
day_3_sms_sent_at TIMESTAMPTZ,
day_7_sms_sent_at TIMESTAMPTZ,
day_14_sms_sent_at TIMESTAMPTZ
```

---

## API Routes

### POST /api/twilio/sms-incoming
**Purpose:** Webhook for incoming SMS from Twilio

**What it does:**
1. Receives incoming SMS (form-encoded from Twilio)
2. Normalizes phone number to E.164 format
3. Detects source type from message content:
   - NFC Card mention → `vendor` or `business_card`
   - Contest mention → `contest`
   - Default → `inbound`
4. Finds or creates conversation (grouped by phone + source)
5. If AI enabled:
   - Generates response via OpenAI GPT-4o-mini
   - Checks for escalation triggers
   - Sends response via Twilio
   - Creates lead when name + email + address collected
6. If AI disabled:
   - Logs message
   - Alerts admin
7. Returns empty TwiML

**Detection phrases for NFC:**
- "found your card", "scanned your card", "saw your card"
- "from the barbershop/gym/coffee shop"
- "at joe", "tapped", "business card", "nfc"

**Escalation triggers:**
- "emergency", "flood", "burst pipe"
- "angry", "refund", "rude"
- AI response contains escalation phrases

### POST /api/conversations/[id]/reply
**Purpose:** Manual reply from admin UI

**What it does:**
1. Admin types reply in Conversations view
2. Sends SMS to customer
3. Appends to conversation history
4. Logs to sms_logs

### GET /api/cron/nurture-leads
**Purpose:** Daily lead nurturing (runs at 9 AM via Vercel Cron)

**Schedule:** `0 9 * * *` (9 AM daily)

**What it does:**
1. Finds leads created exactly 3 days ago → sends Day 3 SMS ($20 off)
2. Finds leads created exactly 7 days ago → sends Day 7 SMS ($25 off)
3. Finds leads created exactly 14 days ago → sends Day 14 SMS ($30 off)
4. Only targets leads with status 'new' or 'contacted'
5. Only targets sources: 'contest', 'partner', 'website'
6. Tracks sent timestamps to avoid duplicates

**Day 3 message:**
```
Hi {name}, still need carpet cleaning?
You have $20 off! Use coupon: SCC20 (add to notes)
Book now: {booking_link}
- Sasquatch Carpet Cleaning
(719) 249-8791
```

**Day 7 message:**
```
Special offer for {name}!
Get $25 off when you book this week.
Use coupon: SCC25 (add to notes)
{booking_link}
- Sasquatch Carpet Cleaning
(719) 249-8791
```

**Day 14 message:**
```
Last chance, {name}!
Book this week and get $30 off.
Use coupon: SCC30 (add to notes)
{booking_link}
Reply STOP to unsubscribe
- Sasquatch Carpet Cleaning
(719) 249-8791
```

---

## Library: src/lib/twilio.ts

### sendAdminSMS(message, messageType)
Sends alert to Chuck's phone. Used for:
- New contest entries
- Escalations
- AI errors
- Incoming messages when AI disabled

### sendPartnerSMS(phone, message, partnerId, messageType)
Sends SMS to location partners. Used for:
- New referral notifications
- Credit notifications

### sendCustomerSMS(phone, message, leadId, messageType)
Sends SMS to customers. Used for:
- AI dispatcher responses
- Nurture sequence messages
- Manual replies from admin

All functions:
- Log to sms_logs table
- Handle missing credentials gracefully
- Track Twilio SID for delivery

---

## Library: src/lib/openai-chat.ts

### AI Dispatcher System Prompt
The AI knows:
- Company name, booking link, minimum charge ($150)
- Service area (Tri-Lakes, Castle Rock, Northern Springs)
- Full pricing guide (carpet, upholstery, leather, tile, rugs)
- Technical process (CRB technology, deep restoration)
- Payment methods, job duration, scheduling

### Key behaviors:
- Collects: name, email, address before booking
- Asks clarifying questions (never assumes sizes)
- Mentions $150 minimum only when job is under $150
- Recognizes NFC/partner referrals → applies $20 discount
- Escalates emergencies and angry customers
- Keeps responses SMS-friendly (<160 chars when possible)

### isAIEnabled()
Returns true only if:
- `AI_DISPATCHER_ENABLED=true` in environment
- OpenAI API key is configured

### shouldEscalate(response)
Checks if AI response contains escalation phrases

---

## Admin UI: Conversations View

Located at: `/admin` → Leads dropdown → Conversations

**Features:**
- Lists all SMS conversations
- Shows message history per conversation
- Toggle AI on/off per conversation
- Manual reply box
- Source badges (NFC Card, Business Card, Contest, Inbound)
- Status indicators (active, escalated, completed)
- Partner info when applicable

---

## Vercel Cron Jobs

Defined in `vercel.json`:

```json
{
  "crons": [
    {
      "path": "/api/cron/nurture-leads",
      "schedule": "0 9 * * *"
    },
    {
      "path": "/api/cron/station-health",
      "schedule": "0 10 * * *"
    }
  ]
}
```

---

## What's NOT Built Yet

1. **Post-service follow-up SMS** - The "thanks for choosing us, leave a review, share with friends" message after a job is completed

2. **Appointment reminders** - Day before / morning of reminders

3. **Quote follow-up** - If customer got quote but didn't book

4. **Review request automation** - Timed review requests after service

5. **Call forwarding** - The number needs call forwarding configured in Twilio (separate from SMS)

---

## New Review/Share Page

Just built at `/links` (short URL: `/r`)

**Purpose:** Post-service follow-up page to send customers

**Contains:**
- Review buttons (Google, Facebook, Yelp, Nextdoor, BBB)
- Book Again button with NEXT20 code
- Share with Friend button with SHARE20 code
- Recent work carousel
- Sasquatch character background

**Draft SMS for post-service:**
```
Thanks for choosing Sasquatch! 🦶 As a local family-owned business, your support & reviews mean the world to us. Know anyone who needs a cleaning? Share this link - they'll get $20 off their first service: sasquatchsightings.com/r
```
(275 characters)

---

## Phone Number Status

- **Number:** 719-249-8791
- **Previously:** RingCentral
- **Now:** Ported to Twilio
- **SMS:** Needs webhook configured (see above)
- **Voice/Calls:** Need separate configuration for call handling (forwarding, voicemail, etc.)

---

## Quick Reference: File Locations

```
src/lib/twilio.ts                       # SMS sending functions
src/lib/openai-chat.ts                  # AI dispatcher logic
src/app/api/twilio/sms-incoming/route.ts # Incoming SMS webhook
src/app/api/conversations/[id]/reply/route.ts # Manual reply
src/app/api/cron/nurture-leads/route.ts # Lead nurturing cron
src/components/admin/conversations-view.tsx # Admin UI
src/app/links/page.tsx                  # Review/share page
src/app/r/page.tsx                      # Short redirect
vercel.json                             # Cron schedules
```

---

## Testing Checklist

After webhook configuration:

- [ ] Text the number → AI responds
- [ ] Text "I found your card at Joe's" → Recognizes as NFC
- [ ] Say "emergency flood" → Escalates to admin
- [ ] Check Conversations view shows the thread
- [ ] Check sms_logs table has entries
- [ ] Verify admin gets escalation alerts
- [ ] Test manual reply from admin UI
