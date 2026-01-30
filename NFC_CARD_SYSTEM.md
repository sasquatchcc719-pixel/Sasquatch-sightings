# 🎴 NFC Card Landing Page & Analytics

## Overview

A complete NFC business card system that tracks engagement and conversions. When someone taps your NFC card with their phone, they land on a custom page with your $20 off offer and can instantly contact you.

---

## ✨ Features

### Customer-Facing Landing Page (`/tap`)
- **Mobile-optimized** design (99% of taps are from phones)
- **Instant contact options:**
  - 📞 Tap to call (719-249-8791)
  - 💬 Tap to text
  - 📋 Request callback form
  - 📇 Save to contacts (vCard download)
- **$20 off promotion** prominently displayed
- **Service areas** listed
- **Why Choose Us** section
- **Card image** displayed at top

### Admin Analytics Dashboard (`/admin/tap-analytics`)
- **Total taps** & unique visitors
- **Conversion tracking** (form submissions)
- **Button click analytics:**
  - Call button clicks
  - Text button clicks
  - Form submissions
  - Save contact clicks
- **Time-based metrics:**
  - Today, this week, this month, all time
- **Geographic data:**
  - Top cities where cards are being tapped
- **Device breakdown:**
  - Mobile vs desktop vs tablet
- **ROI calculator:**
  - Estimate revenue from conversions

### Tracking System
- Every tap is logged automatically
- IP-based location detection
- Device type detection
- Button click tracking
- Conversion attribution

---

## 🚀 How to Use

### 1. Order Your NFC Cards

**Simple Option (Recommended):**
All cards have the same URL: `https://sightings.sasquatchcarpet.com/tap`

**Advanced Option:**
Individual card tracking: `https://sightings.sasquatchcarpet.com/tap?card=001`

### 2. Apply the Database Migration

Run this SQL in your Supabase dashboard:
```bash
migrations/add_nfc_card_tracking.sql
```

This creates:
- `nfc_card_taps` table (tracks every tap)
- `nfc_button_clicks` table (tracks button engagement)

### 3. Deploy to Production

```bash
git push origin feature/nfc-card-landing
```

Vercel will auto-deploy and the landing page will be live!

### 4. Hand Out Cards

Just give them out like regular business cards:
- At networking events
- On job sites
- To satisfied customers
- Leave at local businesses

### 5. Track Performance

Go to **Admin → NFC Cards** to see:
- How many taps you're getting
- Which buttons people click most
- Conversion rate (taps → leads)
- Geographic distribution
- Device types

---

## 📊 What You Can Track

### Basic Metrics
- ✅ Total taps
- ✅ Unique visitors
- ✅ Conversions (form submissions)
- ✅ Conversion rate %

### Engagement Metrics
- ✅ Call button clicks
- ✅ Text button clicks
- ✅ Form submissions
- ✅ Save contact clicks

### Demographic Data
- ✅ Device types (mobile, tablet, desktop)
- ✅ Top cities (IP-based location)
- ✅ Time of day patterns

### ROI Tracking
- ✅ Taps → Leads → Revenue
- ✅ Cost per lead
- ✅ Return on card investment

---

## 🎯 Phase 2: Partner Cards (Future)

The system is architected to support partner-specific cards:

**Partner Card URL:** `/tap/partner/[id]`

**Partner Card Features:**
- Auto-login to partner portal (no password needed!)
- Partner keeps card in wallet for instant access
- Track partner engagement
- Attribute referrals to specific partners
- Custom landing page per partner

When ready to implement Phase 2, we just:
1. Add partner ID detection
2. Create partner-specific landing pages
3. Add auto-authentication logic

---

## 📁 Files Created

### Landing Page
- `src/app/tap/page.tsx` - Customer-facing landing page

### API
- `src/app/api/tap/track/route.ts` - Tracking endpoint

### Admin
- `src/app/admin/tap-analytics/page.tsx` - Analytics dashboard

### Database
- `migrations/add_nfc_card_tracking.sql` - Database schema

### Assets
- `public/nfc-card.png` - Your card design image

### Navigation
- `src/components/admin-navigation.tsx` - Updated with "NFC Cards" tab

---

## 🔧 Technical Details

### Database Tables

**nfc_card_taps:**
- Tracks every page visit (tap)
- Stores: card ID, IP, location, device, timestamp
- Tracks conversion status
- Links to leads table

**nfc_button_clicks:**
- Tracks every button click
- Stores: button type, timestamp
- Links back to tap record

### Tracking Flow

1. User taps card → Opens `/tap` page
2. Page loads → Automatically logs tap in database
3. User clicks button → Logs button click
4. User submits form → Creates lead + marks tap as converted

### Privacy & Security

- Only IP address stored (no personal data without consent)
- RLS policies protect admin data
- Public can insert taps (anonymous)
- Only admins can read analytics

---

## 💡 Best Practices

### Card Distribution
- Give cards to satisfied customers
- Hand out at networking events
- Leave with local business partners
- Include with invoices

### Tracking
- Check analytics weekly
- Compare conversion rates over time
- See which distribution methods work best
- Adjust strategy based on data

### Follow-up
- Respond quickly to form submissions
- Call back within 24 hours
- Apply the $20 discount
- Track which leads convert to jobs

---

## 🎨 Customization Ideas

### Landing Page
- Add before/after photos
- Include customer testimonials
- Show current promotions
- Link to contest entry

### Analytics
- Set conversion goals
- Compare card batches
- Track cost per acquisition
- A/B test different offers

### Integration
- Connect to CRM
- Push notifications on tap
- Email alerts for conversions
- SMS follow-up automation

---

## 📈 Success Metrics

Track these KPIs:
- **Engagement Rate:** (Taps / Cards Distributed)
- **Conversion Rate:** (Leads / Taps)
- **Cost Per Lead:** (Card Cost / Leads Generated)
- **ROI:** (Revenue from Conversions / Card Cost)

Example:
- 100 cards printed = $150
- 50 taps = 50% engagement
- 10 leads = 20% conversion
- 3 jobs = $600 revenue
- **ROI = 4x** 🎉

---

## 🚀 Next Steps

1. ✅ Review the landing page design
2. ✅ Apply database migration
3. ✅ Push to production
4. ✅ Order NFC cards with the URL
5. ✅ Start handing them out
6. ✅ Track results in admin dashboard
7. ✅ Optimize based on data

---

**Questions?** Check the analytics dashboard for insights!

**Ready for Phase 2?** Let me know when you want partner-specific cards!
