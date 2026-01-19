# 🚀 Backfill Script Quick Start

## What This Does
Automatically populates `city` and `state` fields for existing sightings that have GPS coordinates but no location data.

---

## Prerequisites

1. ✅ **Database migration completed** (city/state columns exist)
2. ✅ **Environment variables set** (`.env.local` with Supabase credentials)
3. ✅ **Dependencies installed** (run `npm install` first)

---

## How to Run

### Step 1: Install dependencies (if not already done)
```bash
cd "/Users/chuckdeezil/Sasquatch Sightings "
npm install
```

This will install the `tsx` package needed to run TypeScript scripts.

### Step 2: Run the backfill script
```bash
npm run backfill-locations
```

**Alternative (if the npm script doesn't work):**
```bash
npx tsx scripts/backfill-sighting-locations.ts
```

---

## What to Expect

### Console Output
```
🚀 Starting location backfill for existing sightings...

📊 Querying sightings that need location data...
📍 Found 12 sighting(s) to backfill

[1/12] Processing sighting a1b2c3d4-e5f6-7g8h-9i0j-k1l2m3n4o5p6...
   GPS: 39.7392, -104.9903
   🌍 Calling Nominatim...
   📍 Found: Denver, CO
   ✅ Updated successfully
   ⏱️  Waiting 1 second (Nominatim rate limit)...

[2/12] Processing sighting b2c3d4e5-f6g7-8h9i-0j1k-l2m3n4o5p6q7...
   GPS: 40.7128, -74.0060
   🌍 Calling Nominatim...
   📍 Found: New York, NY
   ✅ Updated successfully
   ⏱️  Waiting 1 second (Nominatim rate limit)...

... (continues for all sightings) ...

============================================================
📊 BACKFILL COMPLETE
============================================================
✅ Successful: 12
❌ Failed:     0
⚠️  Skipped:    0
📍 Total:      12
============================================================

✅ All sightings processed successfully!
```

### Timing
- **Per sighting:** ~2 seconds (1 second API call + 1 second rate limit delay)
- **10 sightings:** ~20 seconds
- **50 sightings:** ~100 seconds (~1.7 minutes)
- **100 sightings:** ~200 seconds (~3.3 minutes)

---

## Verify Results

### Check the Database
```sql
-- In Supabase SQL Editor
SELECT id, city, state, gps_lat, gps_lng, created_at
FROM sightings
WHERE city IS NOT NULL
ORDER BY created_at DESC
LIMIT 10;
```

### Check a Share Page
1. Visit a sighting URL: `https://sightings.sasquatchcarpet.com/sightings/share/[id]`
2. The title should show the specific location (e.g., "Sasquatch Spotted in Denver, CO!")

---

## Troubleshooting

### Error: "Missing environment variables"
**Solution:** Make sure `.env.local` exists and contains:
```env
NEXT_PUBLIC_SUPABASE_URL=your_url_here
SUPABASE_SERVICE_ROLE_KEY=your_service_key_here
```

### Error: "Column does not exist"
**Solution:** Run the database migration first:
```sql
-- In Supabase SQL Editor
ALTER TABLE sightings ADD COLUMN IF NOT EXISTS city TEXT;
ALTER TABLE sightings ADD COLUMN IF NOT EXISTS state TEXT;
```

### Error: "No sightings need backfilling"
**Meaning:** All sightings already have location data, or none have GPS coordinates. This is not an error—the script is just confirming there's nothing to do.

### Warning: "Could not determine city, skipping"
**Meaning:** The GPS coordinates are either:
- Outside a recognized city boundary
- In a remote area with no city data
- Invalid coordinates

These sightings will be skipped but the script will continue.

### Error: Rate limit exceeded
**Meaning:** Nominatim has a 1 request/second limit. The script already respects this, but if you run it multiple times in quick succession, you may hit the limit.

**Solution:** Wait 1 minute and try again.

---

## Safety Notes

✅ **Safe to run multiple times** - Only updates records where `city IS NULL`  
✅ **Does not modify GPS coordinates** - Only adds location data  
✅ **Does not affect new submissions** - New sightings get location automatically  
✅ **Uses service role key** - Bypasses Row Level Security (RLS) for admin access  
✅ **Respects rate limits** - 1 second delay between API calls  

---

## After Running

1. ✅ All existing sightings should now have `city` and `state` fields
2. ✅ Share pages will show specific locations in titles/descriptions
3. ✅ Facebook previews will be more descriptive
4. ✅ Google will have better location context for indexing

---

## Need Help?

- **Full documentation:** See `scripts/README.md`
- **Deployment guide:** See `DEPLOYMENT_STEPS.md`
- **Technical details:** See `SEO_FIX_SUMMARY.md`

---

**Ready?** Run: `npm run backfill-locations`
