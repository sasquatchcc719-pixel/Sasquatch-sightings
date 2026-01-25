# SMS Future Features

## Overview
This document contains SMS feature ideas that require more planning, discussion, or infrastructure before implementation. These are parked for future consideration.

---

## 🔮 Future Features (Not Building Yet)

### 1. SMS Opt-Out Tracking

**The Problem:**
- By law (TCPA), customers must be able to opt out of SMS
- Need to track who has opted out and never text them again

**How It Would Work:**
```
Customer replies: "STOP"
↓
Your app receives it via Twilio webhook
↓
Mark lead as opted out in database
↓
All future SMS checks opt-out status first
```

**Technical Requirements:**
- Add `sms_opted_out` boolean column to `leads` table
- Add `sms_opted_out_at` timestamp column
- Create `/api/sms/incoming` webhook endpoint
- Configure Twilio to send inbound SMS to this endpoint
- Parse replies for STOP, UNSUBSCRIBE, etc.
- Update lead record when opt-out detected

**Questions to Answer:**
- What other keywords besides STOP? (UNSUBSCRIBE, CANCEL, END, QUIT)
- Should we send confirmation? "You're unsubscribed from Sasquatch SMS"
- Can they opt back in? How?
- Do we need opt-in consent tracking too?

---

### 2. Partner Text-In Referrals

**The Idea:**
Partners can text referral info directly to your Twilio number, and it auto-creates the referral in your system.

**How It Would Work:**
```
Partner texts: "John Smith 303-555-1234 needs carpet cleaning"
↓
Your app receives it via Twilio webhook
↓
AI/parser extracts: name, phone, notes
↓
Looks up which partner sent it (by their phone number)
↓
Creates referral automatically
↓
Sends confirmation to partner
↓
Sends auto-response to customer
↓
Sends admin notification to you
```

**Example Flow:**
1. Partner (Sarah, 720-555-9999): "Mike Johnson 303-123-4567 - 3 bedroom house in Denver"
2. System creates referral linked to Sarah
3. Sarah gets: "✅ Referral received for Mike Johnson!"
4. Mike gets: "Thanks for reaching out! Sarah recommended us. Book now: [link]"
5. You get: "🤝 Sarah just texted in a referral: Mike Johnson - (303) 123-4567"

**Technical Requirements:**
- Inbound SMS webhook endpoint (`/api/sms/incoming`)
- Phone number lookup to identify which partner sent it
- Text parsing/AI to extract name and phone number
- Validation to ensure required info is present
- Error handling for malformed messages
- Response messages for success/failure

**Questions to Answer:**
- What format should partners use? Free-form or structured?
- Should we use AI (Claude/GPT) to parse free-form text?
- What if we can't identify the sender? (Not in partners table)
- What if parsing fails? Send error message back?
- Should partners be trained on a specific format?
- Rate limiting to prevent abuse?

**Suggested Message Format for Partners:**
```
REFERRAL: John Smith, 303-555-1234, needs 2 bedrooms cleaned
```
Or just free-form and use AI to parse it.

---

### 3. Two-Way SMS Conversations

**The Idea:**
Customers can reply to your SMS and you see their responses in your admin dashboard (or get forwarded to your phone).

**How It Would Work:**

**Option A: Admin Dashboard Display**
```
Customer replies to nurture SMS: "Yes, interested! Call me tomorrow."
↓
Stored in database linked to their lead
↓
Shows up in admin leads page as a conversation thread
↓
You can reply from admin panel
```

**Option B: Forward to Your Phone**
```
Customer replies: "Yes, interested!"
↓
You get SMS at (719) 249-8791: "Lead [Name] replied: Yes, interested!"
↓
You text them back directly from your phone
```

**Option C: Hybrid**
- You get immediate notification SMS
- Conversation also logged in admin dashboard
- You can reply from either place

**Technical Requirements:**
- Inbound SMS webhook (`/api/sms/incoming`)
- Database table for SMS conversations/threads
- UI in admin panel to view conversations
- Reply functionality from admin panel
- Link replies to correct lead record
- Handle unknown senders (not in database yet)

**Questions to Answer:**
- Do we need a full conversation UI or just notifications?
- Should replies create tasks/reminders for you?
- What about spam/wrong numbers?
- Should we auto-reply to unknown numbers?
- Track conversation history per lead?

---

### 4. Smart Reply Detection

**The Idea:**
Detect certain replies and trigger automatic actions.

**Examples:**

**Reply: "YES" or "INTERESTED"**
- Auto-update lead status to "interested"
- Send you notification
- Send customer: "Great! We'll call you today. Or book now: [link]"

**Reply: "CALL ME"**
- Update lead status to "requested_callback"
- Send you urgent notification
- Add to your call queue
- Send customer: "Got it! We'll call you within 2 hours."

**Reply: "NOT INTERESTED"**
- Update lead status to "lost"
- Stop sending nurture SMS
- Send customer: "No problem! If you change your mind: [link]"

**Reply: Question (detected by "?" character)**
- Forward to you immediately
- Send customer: "Thanks for your question! We'll respond shortly."

**Technical Requirements:**
- Inbound SMS webhook
- Keyword/pattern detection (or AI)
- Action mapping (keyword → what to do)
- Status updates in database
- Smart auto-responses

---

### 5. Scheduled SMS Campaigns

**The Idea:**
Send one-time promotional SMS to specific segments of your leads.

**Examples:**
- "Spring Cleaning Special: $40 off this week only!"
- Send to all leads with status 'lost' from last 6 months
- Or all leads that haven't booked yet

**How It Would Work:**
```
Admin dashboard → Campaigns tab
↓
Select segment: "Leads - Lost - Last 6 months"
↓
Write message
↓
Preview recipient count
↓
Schedule send time
↓
Sends to all matching leads (who haven't opted out)
```

**Technical Requirements:**
- Campaign management UI
- Lead segmentation/filtering
- Scheduled send logic
- Bulk SMS sending (respects rate limits)
- Opt-out checking
- Campaign tracking (opens, clicks, conversions)

**Questions to Answer:**
- How often should campaigns be allowed?
- Cost considerations (SMS fees per message)
- Compliance with TCPA regulations
- Preview/testing before sending to everyone

---

### 6. SMS Analytics Dashboard

**The Idea:**
Track SMS performance metrics to optimize messaging.

**Metrics to Track:**
- Total SMS sent (by type: nurture, referral, etc.)
- Delivery rate
- Response rate
- Opt-out rate
- Cost per SMS
- Conversions from SMS (bookings)
- Best performing messages
- Best times to send

**How It Would Work:**
- Log every SMS sent to database
- Track delivery status (via Twilio webhooks)
- Track replies/engagement
- Link to booking conversions
- Display charts/graphs in admin dashboard

**Technical Requirements:**
- `sms_logs` database table
- Twilio delivery webhook integration
- Analytics calculation logic
- Dashboard UI with charts
- Date range filtering
- Export to CSV

---

### 7. Multi-Language SMS Support

**The Idea:**
Detect customer's preferred language and send SMS in that language.

**How It Would Work:**
- Store language preference in leads table (detected from form submission or previous interaction)
- Maintain message templates in multiple languages
- Send appropriate language version

**Questions to Answer:**
- What languages? (Spanish most likely)
- How to detect language preference?
- Who translates the messages?
- Does HouseCall Pro booking link work in Spanish?

---

## 🤔 Open Questions

These questions need answers before building any of the above:

1. **Inbound SMS Priority:**
   - Which inbound SMS feature is most valuable?
   - Partner text-in referrals?
   - Customer replies for lead qualification?
   - Two-way conversations?

2. **Compliance:**
   - Do we need explicit opt-in consent before sending SMS?
   - Currently sending to contest entries and referrals (implied consent?)
   - Need legal review?

3. **Cost:**
   - Twilio charges per SMS sent
   - How many leads per month?
   - What's acceptable monthly SMS budget?
   - Currently on trial - what happens when trial ends?

4. **Infrastructure:**
   - Should we build conversation UI or keep it simple?
   - Forward to personal phone vs admin dashboard?
   - How much automation vs manual handling?

5. **Response Expectations:**
   - If customers can text back, what's your response time?
   - Need someone monitoring dashboard?
   - After-hours handling?

---

## 📋 Next Steps When Ready

When you want to implement any of these:

1. **Pick one feature** from the list above
2. **Answer the questions** specific to that feature
3. **Create detailed implementation plan** (like SMS_IMPLEMENTATION.md)
4. **Build on feature branch**
5. **Test thoroughly**
6. **Deploy incrementally**

---

## 💡 Feature Priority Recommendations

**High Value / Low Complexity:**
1. SMS opt-out tracking (legal requirement eventually)
2. Smart reply detection for "YES/NO"

**High Value / Medium Complexity:**
3. Partner text-in referrals
4. Customer reply forwarding to your phone

**High Value / High Complexity:**
5. Two-way conversation dashboard
6. SMS analytics

**Lower Priority:**
7. Scheduled campaigns (can do manually for now)
8. Multi-language (if customer base expands)

---

## 🔗 Related Documents

- `SMS_IMPLEMENTATION.md` - What we're building NOW
- `TWILIO_INTEGRATION_PLAN.md` - Original Twilio setup
