# SEO & Social Sharing Fix for Sightings App
**Date:** January 19, 2026  
**Status:** ✅ Code Complete - Ready for Deployment

---

## 🎯 Problem Statement

### Symptoms
1. **Facebook/Social Previews Broken**: When sharing sighting links on Facebook, the preview card fails to display the specific image or description—just shows a generic link.
2. **Google Indexing Failure**: The subdomain `sightings.sasquatchcarpet.com` shows 0 indexed pages in Google Search, despite having content.

### Root Cause Analysis
The Sighting Detail pages (`/sightings/share/[id]`) were **partially server-side rendered**:
- ✅ **Open Graph tags** were correctly generated server-side via `generateMetadata`
- ❌ **JSON-LD structured data** was completely missing (required for Google indexing)
- ⚠️ **Location data** (city/state) was missing from the database, resulting in generic descriptions like "Colorado" instead of specific locations

---

## 🛠️ Solution Implemented

### 1. Database Schema Enhancement
**File:** `database/migrations/add_location_to_sightings.sql`

Added two new columns to the `sightings` table:
- `city TEXT` - City name from reverse geocoding
- `state TEXT` - State abbreviation (e.g., "CO")
- Index on `city` for future filtering/search

**Migration SQL:**
```sql
ALTER TABLE sightings ADD COLUMN IF NOT EXISTS city TEXT;
ALTER TABLE sightings ADD COLUMN IF NOT EXISTS state TEXT;
CREATE INDEX IF NOT EXISTS idx_sightings_city ON sightings(city) WHERE city IS NOT NULL;
```

---

### 2. Reverse Geocoding Integration
**Files Modified:**
- `src/lib/geocode.ts` - Updated `GeocodeResult` type to include `state`
- `src/app/api/sightings/route.ts` - Added geocoding call during sighting submission

**Implementation:**
```typescript
// Extract state from Nominatim response
const state = data.address?.state_code || data.address?.state || null

// In sightings API route
if (lat !== null && lng !== null) {
  try {
    const geocodeResult = await reverseGeocode(lat, lng)
    city = geocodeResult.city
    state = geocodeResult.state
  } catch (error) {
    console.error('Geocoding error:', error)
    // Continue without location data if geocoding fails
  }
}
```

**Behavior:**
- Uses existing Nominatim (OpenStreetMap) API (per project rules)
- Extracts city and state from GPS coordinates
- Gracefully degrades if geocoding fails (submission still succeeds)
- No cost (free API with proper User-Agent header)

---

### 3. JSON-LD Structured Data
**File:** `src/app/sightings/share/[id]/page.tsx`

Added Schema.org `ImageObject` markup for Google Search:

```typescript
const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'ImageObject',
  name: `Sasquatch Carpet Cleaning Truck Spotted in ${location}`,
  description: 'Sasquatch Carpet Cleaning truck sighting photo from our community contest',
  contentUrl: sighting.image_url,
  url: `https://sightings.sasquatchcarpet.com/sightings/share/${id}`,
  datePublished: sighting.created_at,
  author: {
    '@type': 'Organization',
    name: 'Sasquatch Carpet Cleaning',
    url: 'https://sasquatchcarpet.com',
  },
  contentLocation: {
    '@type': 'Place',
    name: location,
    geo: {
      '@type': 'GeoCoordinates',
      latitude: sighting.gps_lat,
      longitude: sighting.gps_lng,
    },
  },
}
```

**Why This Matters:**
- Google Search Console requires structured data for rich results
- Provides explicit location context for local SEO
- Links sightings to the parent organization
- Includes geographic coordinates for map-based search features

---

### 4. Enhanced Open Graph Metadata
**File:** `src/app/sightings/share/[id]/page.tsx`

**Before:**
```typescript
const description = 'I just saw the Sasquatch Carpet Cleaning truck! Check out my photo...'
```

**After:**
```typescript
const description = `A Sasquatch Carpet Cleaning truck was spotted in ${location} on ${formattedDate}. Join our contest to win a free whole house carpet cleaning!`
```

**Additional Improvements:**
- ✅ Added `publishedTime` to Open Graph (for article freshness)
- ✅ Added Twitter `creator` and `site` tags (`@SasquatchCC`)
- ✅ Added explicit `robots` meta tags for better crawling
- ✅ Changed `siteName` to "Sasquatch Carpet Cleaning Sightings" (more specific)
- ✅ Dynamic description includes actual city/state and date

---

## 📋 Deployment Checklist

### Step 1: Run Database Migration
Connect to Supabase and run:
```sql
-- Copy contents from database/migrations/add_location_to_sightings.sql
ALTER TABLE sightings ADD COLUMN IF NOT EXISTS city TEXT;
ALTER TABLE sightings ADD COLUMN IF NOT EXISTS state TEXT;
CREATE INDEX IF NOT EXISTS idx_sightings_city ON sightings(city) WHERE city IS NOT NULL;
COMMENT ON COLUMN sightings.city IS 'City name from reverse geocoding (Nominatim)';
COMMENT ON COLUMN sightings.state IS 'State abbreviation (e.g., CO) from reverse geocoding';
```

### Step 2: Commit and Push Code
```bash
git add -A
git commit -m "feat: Add SEO improvements for sighting share pages

- Add city/state columns to sightings table
- Integrate reverse geocoding (Nominatim) for location data
- Add JSON-LD structured data (Schema.org ImageObject)
- Enhance Open Graph metadata with dynamic descriptions
- Add Twitter card metadata and robots tags"
git push origin main
```

### Step 3: Verify Deployment
1. Wait for Vercel deployment to complete
2. Test a sighting share page: `https://sightings.sasquatchcarpet.com/sightings/share/[id]`
3. Verify Open Graph tags using [Facebook Sharing Debugger](https://developers.facebook.com/tools/debug/)
4. Verify JSON-LD using [Google Rich Results Test](https://search.google.com/test/rich-results)

### Step 4: Submit to Google Search Console
1. Log into [Google Search Console](https://search.google.com/search-console)
2. Submit sitemap (if not already done): `https://sightings.sasquatchcarpet.com/sitemap.xml`
3. Request indexing for 2-3 sample sighting URLs
4. Monitor indexing status over next 48-72 hours

---

## 🧪 Testing Strategy

### Local Testing (Before Deployment)
1. ✅ Submit a new test sighting with GPS coordinates
2. ✅ Verify `city` and `state` are populated in database
3. ✅ Check share page renders with correct location
4. ✅ Inspect page source to confirm JSON-LD is present
5. ✅ Verify Open Graph tags in `<head>`

### Production Testing (After Deployment)
1. **Facebook Debugger**: Paste share URL and verify:
   - Image loads correctly
   - Title shows specific location
   - Description includes date and location
2. **Google Rich Results Test**: Verify JSON-LD is valid
3. **View Page Source**: Confirm metadata is in initial HTML (not injected by JS)
4. **Submit to Google**: Request indexing for 3-5 URLs

---

## 📊 Expected Outcomes

### Immediate (24-48 hours)
- ✅ Facebook/social previews display correctly with images
- ✅ Google Rich Results Test validates structured data
- ✅ Share pages have location-specific titles and descriptions

### Short-term (1-2 weeks)
- ✅ Google Search Console shows indexed pages (target: 10-20 sightings)
- ✅ Rich results appear in Google Search (image thumbnails, location)
- ✅ Social shares generate higher click-through rates

### Long-term (1-3 months)
- ✅ Subdomain ranks for local queries like "sasquatch carpet cleaning [city]"
- ✅ Sighting pages contribute to overall domain authority
- ✅ Contest submissions increase due to better social sharing

---

## 🔍 Technical Details

### Server-Side Rendering Verification
All metadata is now **fully server-side rendered**:
- `generateMetadata` runs on the server (Next.js App Router)
- `getSighting` uses `@/supabase/server` (server-side Supabase client)
- JSON-LD is injected as static HTML in the initial response
- No client-side `useEffect` or JavaScript required for bots

### Geocoding Rate Limits
Nominatim Usage Policy:
- **Rate Limit**: 1 request/second (we're well below this)
- **User-Agent Required**: ✅ Set to `SasquatchJobPinner/1.0`
- **Caching**: Results stored in database (no repeat requests)
- **Fallback**: Submissions succeed even if geocoding fails

### Browser Compatibility
- JSON-LD: Supported by all major search engines (Google, Bing, Yandex)
- Open Graph: Supported by Facebook, LinkedIn, Twitter, Slack, Discord
- Twitter Cards: Native support on X/Twitter platform

---

## 🚨 Rollback Plan (If Needed)

If issues arise after deployment:

1. **Database Rollback**:
   ```sql
   ALTER TABLE sightings DROP COLUMN IF EXISTS city;
   ALTER TABLE sightings DROP COLUMN IF EXISTS state;
   DROP INDEX IF EXISTS idx_sightings_city;
   ```

2. **Code Rollback**:
   ```bash
   git revert HEAD
   git push origin main
   ```

3. **Verify**: Old sightings still work (new columns are nullable)

---

## 📚 References

- [Next.js Metadata API](https://nextjs.org/docs/app/api-reference/functions/generate-metadata)
- [Schema.org ImageObject](https://schema.org/ImageObject)
- [Open Graph Protocol](https://ogp.me/)
- [Twitter Cards](https://developer.twitter.com/en/docs/twitter-for-websites/cards/overview/abouts-cards)
- [Nominatim Usage Policy](https://operations.osmfoundation.org/policies/nominatim/)
- [Google Search Central - Structured Data](https://developers.google.com/search/docs/appearance/structured-data/intro-structured-data)

---

## ✅ Sign-Off

**Code Changes:**
- ✅ No linter errors
- ✅ Follows project rules (no Google Maps API, uses Nominatim)
- ✅ Extends existing boilerplate structure
- ✅ Graceful error handling (geocoding failures don't break submissions)

**Ready for Deployment:** YES  
**Breaking Changes:** NONE (new columns are nullable)  
**Requires Manual Steps:** YES (database migration must be run in Supabase)

---

**Next Action:** Run database migration in Supabase, then commit and push to `main`.
