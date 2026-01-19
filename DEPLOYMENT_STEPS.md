# 🚀 Deployment Steps for SEO Fix

## ✅ Completed
- [x] Code changes committed and pushed to GitHub
- [x] Vercel deployment triggered automatically

---

## 🔴 CRITICAL: Database Migration Required

**You must run this SQL in Supabase before the new code will work properly.**

### Step 1: Open Supabase SQL Editor
1. Go to https://supabase.com/dashboard
2. Select your project: **Sasquatch Sightings**
3. Click **SQL Editor** in the left sidebar
4. Click **New Query**

### Step 2: Run This SQL
Copy and paste the following SQL and click **Run**:

```sql
-- Add city and state columns to sightings table
ALTER TABLE sightings ADD COLUMN IF NOT EXISTS city TEXT;
ALTER TABLE sightings ADD COLUMN IF NOT EXISTS state TEXT;

-- Add index for city queries (for future filtering/search)
CREATE INDEX IF NOT EXISTS idx_sightings_city ON sightings(city) WHERE city IS NOT NULL;

-- Add comments for documentation
COMMENT ON COLUMN sightings.city IS 'City name from reverse geocoding (Nominatim)';
COMMENT ON COLUMN sightings.state IS 'State abbreviation (e.g., CO) from reverse geocoding';
```

### Step 3: Verify Migration
Run this query to confirm the columns exist:

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'sightings'
AND column_name IN ('city', 'state');
```

**Expected Result:**
```
city    | text | YES
state   | text | YES
```

---

## 🧪 Testing After Deployment

### Test 1: Submit a New Sighting
1. Go to https://sightings.sasquatchcarpet.com/sightings
2. Upload a photo with GPS data
3. Submit the form
4. Check the database to verify `city` and `state` are populated:

```sql
SELECT id, city, state, gps_lat, gps_lng, created_at
FROM sightings
ORDER BY created_at DESC
LIMIT 5;
```

### Test 2: Check Share Page Metadata
1. Get a sighting share URL: `https://sightings.sasquatchcarpet.com/sightings/share/[id]`
2. View page source (right-click → View Page Source)
3. Search for `application/ld+json` - you should see the JSON-LD schema
4. Search for `og:image` - you should see the Supabase image URL

### Test 3: Facebook Sharing Debugger
1. Go to https://developers.facebook.com/tools/debug/
2. Paste a sighting share URL
3. Click **Scrape Again** (to clear cache)
4. Verify:
   - ✅ Image displays correctly
   - ✅ Title shows specific location (e.g., "Sasquatch Spotted in Denver, CO!")
   - ✅ Description includes date and location

### Test 4: Google Rich Results Test
1. Go to https://search.google.com/test/rich-results
2. Paste a sighting share URL
3. Click **Test URL**
4. Verify:
   - ✅ "Page is eligible for rich results"
   - ✅ ImageObject schema is detected
   - ✅ No errors or warnings

---

## 📊 Monitoring

### Vercel Deployment
- Check https://vercel.com/dashboard for deployment status
- Should complete in 2-3 minutes
- Look for "Deployment Successful" status

### Google Search Console (48-72 hours)
1. Go to https://search.google.com/search-console
2. Select property: `sightings.sasquatchcarpet.com`
3. Go to **URL Inspection** tool
4. Paste 3-5 sighting share URLs
5. Click **Request Indexing** for each

### Expected Timeline
- **Immediate**: Facebook previews work
- **24-48 hours**: Google validates structured data
- **1-2 weeks**: Pages appear in Google Search
- **1-3 months**: Ranking for local queries

---

## 🚨 Troubleshooting

### Issue: "Column does not exist" error in logs
**Solution:** Run the database migration (Step 1 above)

### Issue: Facebook preview still shows old data
**Solution:** Use Facebook Sharing Debugger and click "Scrape Again" to clear cache

### Issue: City/state are NULL for new sightings
**Possible Causes:**
1. GPS coordinates missing from photo EXIF
2. Nominatim API rate limit (unlikely, but wait 1 second and retry)
3. Network error during geocoding (check Vercel logs)

**Check Logs:**
```bash
# In Vercel dashboard, go to your deployment → Runtime Logs
# Look for "Geocoding error:" messages
```

### Issue: JSON-LD not showing in page source
**Solution:** Make sure you're viewing the **initial HTML response**, not the JavaScript-rendered version:
- Use `curl` command: `curl https://sightings.sasquatchcarpet.com/sightings/share/[id]`
- Search for `application/ld+json` in the output

---

## 📝 Next Steps (Optional)

### 1. Backfill Existing Sightings
If you have existing sightings without city/state, you can backfill them automatically:

**Option A: Run the automated script (RECOMMENDED)**

```bash
# Install the tsx dependency first
npm install

# Run the backfill script
npm run backfill-locations
```

The script will:
- Find all sightings with GPS but no city/state
- Call Nominatim for each one (1 second delay between requests)
- Update the database automatically
- Show detailed progress logs

**Expected output:**
```
🚀 Starting location backfill for existing sightings...
📍 Found 12 sighting(s) to backfill

[1/12] Processing sighting a1b2c3d4-...
   GPS: 39.7392, -104.9903
   🌍 Calling Nominatim...
   📍 Found: Denver, CO
   ✅ Updated successfully
   ⏱️  Waiting 1 second (Nominatim rate limit)...
...
✅ All sightings processed successfully!
```

**Option B: Manual SQL (for single records)**

```sql
-- Replace values with actual data
UPDATE sightings
SET city = 'Denver', state = 'CO'
WHERE id = '[sighting-id]'
AND gps_lat IS NOT NULL
AND gps_lng IS NOT NULL
AND city IS NULL;
```

### 2. Create Sitemap
Generate a sitemap for better Google indexing:
- Add `src/app/sitemap.ts` (Next.js dynamic sitemap)
- Include all sighting share URLs
- Submit to Google Search Console

### 3. Add Canonical Tags
If you have multiple URLs pointing to the same sighting, add canonical tags to avoid duplicate content penalties (already implemented in this fix).

---

## ✅ Deployment Complete Checklist

- [ ] Database migration run in Supabase
- [ ] Vercel deployment successful
- [ ] New test sighting submitted (with GPS)
- [ ] City/state populated in database
- [ ] Facebook Sharing Debugger shows correct preview
- [ ] Google Rich Results Test passes
- [ ] JSON-LD visible in page source
- [ ] URLs submitted to Google Search Console

---

**Questions?** Check `SEO_FIX_SUMMARY.md` for technical details or ask Charles.
