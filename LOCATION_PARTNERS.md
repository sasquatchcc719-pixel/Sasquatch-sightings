# Location Partners - NFC Card System

## Overview
The Location Partners system allows you to place NFC business cards at local establishments (barbershops, coffee shops, gyms, bars, etc.). When customers scan the card, the establishment earns rewards, creating a win-win referral network.

## How It Works

### 1. Partner Setup
Each location partner:
- Creates an account in your system (via admin)
- Gets assigned a unique partner ID
- Receives their custom NFC card URL: `/tap?partner=[their-id]`
- Provides phone number for SMS notifications

### 2. Customer Journey
When someone taps the NFC card:
1. They're taken to the landing page (`/tap?partner=[id]`)
2. Page shows: "$20 OFF" offer + partner location badge
3. Customer can:
   - Book online (Housecall Pro)
   - Call
   - Text
   - Save contact
   - Share deal
4. Every action is tracked

### 3. Partner Rewards
When a customer books or submits a form:
- Partner earns $20 credit automatically
- Partner receives SMS notification instantly
- Credit can be used toward their own carpet cleaning

### 4. SMS Notifications
Partners receive texts like:
```
🎉 Your NFC card at Joe's Barbershop just earned you $20 credit! 
New balance: $60. View: https://sasquatchcarpet.com/partner
```

## Database Schema

### Added to `partners` table:
```sql
partner_type TEXT         -- 'referral' or 'location'
card_id TEXT              -- Physical card identifier
location_name TEXT        -- Display name on landing page
location_address TEXT     -- Physical address
location_type TEXT        -- barbershop, bar, gym, etc.
reward_tier INTEGER       -- Future: tiered rewards
total_taps INTEGER        -- Total card scans
total_conversions INTEGER -- Total bookings/forms
```

### Tracks in `nfc_card_taps`:
- partner_id (links to partners table)
- Every page view, location, device type
- Conversion status and type

## Admin Features

### Location Partners Dashboard (`/admin/location-partners`)
- Add new location partners
- View all locations with stats
- Copy unique URLs for each partner
- See real-time performance:
  - Total taps
  - Conversions
  - Conversion rate
  - Credits earned
  - Partner contact info

### NFC Analytics (`/admin/tap-analytics`)
- Overall NFC card performance
- Button click tracking
- City/region breakdown
- Device types
- Time-based trends

## Adding a New Location Partner

### Via Admin UI:
1. Go to `/admin/location-partners`
2. Click "Add Location Partner"
3. Fill out:
   - Business Name (required)
   - Display Name (shown to customers)
   - Address
   - Location Type (barbershop, bar, etc.)
   - Phone Number (for SMS notifications)
   - Card ID (optional physical card tracker)
4. Click "Create"

Partner receives welcome SMS with their unique URL.

### Physical Card Setup:
1. Order NFC cards (Vistaprint, Amazon, etc.)
2. Encode with URL: `https://sasquatchcarpet.com/tap?partner=[their-id]`
3. Give to partner or install at location
4. Partner tapes it to counter, mirror, wall, etc.

## Partner Portal Integration

Location partners can:
- Log in at `/partner`
- View their stats (taps, conversions, credits)
- See credit balance
- Cash in credits for their own cleaning
- Track performance over time

*All existing partner portal features work for location partners!*

## Credit System

### How Credits Are Earned:
- **Booking Click**: Customer clicks "Book Now" → +$20
- **Form Submit**: Customer submits callback form → +$20

### How Credits Are Used:
- Partner books their own cleaning
- Credits automatically applied
- Same as referral partner system

## Marketing Strategy

### Ideal Locations:
1. **Barbershops/Hair Salons** - Captive audience, 30-60min visits
2. **Coffee Shops** - High foot traffic, local clientele
3. **Gyms** - Health-conscious, homeowners
4. **Bars/Restaurants** - Casual browsing time
5. **Pet Stores** - Pet owners = carpet owners
6. **Hardware Stores** - DIY homeowners

### Pitch to Partners:
> "We'll place this free NFC card at your business. Every time someone scans it and books with us, you earn $20 toward free carpet cleaning. No cost, no work—just passive income for your business!"

### Benefits:
- **For You**: Hyperlocal marketing, passive lead generation
- **For Partners**: Free credits, no effort, helps customers
- **For Customers**: Convenient, instant booking, great deal

## Technical Implementation

### Files Modified:
- `migrations/add_location_partners.sql` - Database schema
- `src/app/tap/page.tsx` - Landing page with partner detection
- `src/app/api/tap/track/route.ts` - Partner reward logic + SMS
- `src/app/admin/location-partners/page.tsx` - Admin dashboard
- `src/components/admin-navigation.tsx` - Navigation link

### API Endpoints Used:
- `POST /api/tap/track` - Track taps, clicks, and reward partners
- `POST /api/sms/send` - Send SMS notifications
- `POST /api/leads` - Create leads from form submissions

### Tracking Flow:
```
1. Customer taps NFC card
   ↓
2. Redirect to /tap?partner=[id]
   ↓
3. Track page view + lookup partner
   ↓
4. Show partner badge on page
   ↓
5. Customer clicks "Book Now"
   ↓
6. Track button click
   ↓
7. Mark as conversion
   ↓
8. Award partner $20 credit
   ↓
9. Send SMS to partner
   ↓
10. Update partner stats
```

## Example URLs

### Regular NFC card (no partner):
```
https://sasquatchcarpet.com/tap
```

### Location partner card:
```
https://sasquatchcarpet.com/tap?partner=123e4567-e89b-12d3-a456-426614174000
```

### With custom card ID too:
```
https://sasquatchcarpet.com/tap?partner=123...&card=barbershop-001
```

## Future Enhancements

### Tiered Rewards:
- Bronze: 1-5 conversions → $20/conversion
- Silver: 6-15 conversions → $25/conversion
- Gold: 16+ conversions → $30/conversion + bonuses

### Partner Leaderboard:
- Show top-performing locations
- Monthly prizes
- Recognition badges

### QR Code Generation:
- Auto-generate QR codes for each partner
- Print-ready designs
- Branded materials

### Advanced Analytics:
- Hour-of-day patterns
- Seasonal trends
- Partner performance comparison
- Revenue attribution

## Migration Steps

1. Run migration:
   ```sql
   -- Run in Supabase SQL editor
   -- See: migrations/add_location_partners.sql
   ```

2. Deploy code:
   ```bash
   git add .
   git commit -m "Add location partners system"
   git push origin feature/location-partners
   ```

3. Test in production:
   - Create test partner
   - Scan test card
   - Verify SMS notifications
   - Check credit allocation

4. Roll out:
   - Print first batch of cards
   - Visit local businesses
   - Onboard partners
   - Track performance

## Success Metrics

Track:
- Number of active location partners
- Average taps per location per week
- Overall conversion rate
- Credits earned by partners
- Revenue generated from location cards
- Partner retention rate

## Support

If partners have questions:
- They can log in at `/partner`
- View their unique stats
- See real-time credit balance
- Contact you via their portal

---

**This system turns local businesses into your sales force—with zero ongoing cost and automatic rewards!**
