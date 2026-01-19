# Scripts Directory

This directory contains one-time maintenance scripts and utility tools for the Sasquatch Sightings project.

---

## 📍 Location Backfill Script

### `backfill-sighting-locations.ts`

**Purpose:** One-time script to populate `city` and `state` fields for existing sightings that have GPS coordinates.

**When to use:**
- After deploying the SEO fix (January 2026) to backfill existing records
- After data migration if location data is missing

**How to run:**

```bash
# Make sure you're in the project root
cd "/Users/chuckdeezil/Sasquatch Sightings "

# Run the script with tsx (recommended)
npx tsx scripts/backfill-sighting-locations.ts

# Alternative: Run with ts-node
npx ts-node scripts/backfill-sighting-locations.ts
```

**Requirements:**
- `.env.local` file with:
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`
- Database migration must be run first (city/state columns must exist)

**What it does:**
1. Queries all sightings with GPS coordinates but no city
2. Calls Nominatim reverse geocoding API for each
3. Updates the database with city and state
4. Respects 1-second rate limit between API calls
5. Logs detailed progress

**Expected output:**

```
🚀 Starting location backfill for existing sightings...

📊 Querying sightings that need location data...
📍 Found 12 sighting(s) to backfill

[1/12] Processing sighting a1b2c3d4-...
   GPS: 39.7392, -104.9903
   🌍 Calling Nominatim...
   📍 Found: Denver, CO
   ✅ Updated successfully
   ⏱️  Waiting 1 second (Nominatim rate limit)...

[2/12] Processing sighting e5f6g7h8-...
   ...

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

**Troubleshooting:**

| Error | Solution |
|-------|----------|
| "Missing environment variables" | Add `.env.local` with Supabase credentials |
| "Column does not exist" | Run database migration first |
| "Could not determine city" | GPS coordinates outside valid range or API error |
| "Rate limit exceeded" | Script already has 1-second delay; wait and retry |

**Rate Limiting:**
- Nominatim requires 1 request/second
- Script automatically waits between requests
- For 100 sightings, expect ~2 minutes runtime

**Safety:**
- Uses `SUPABASE_SERVICE_ROLE_KEY` to bypass RLS
- Only updates records where `city IS NULL`
- Does not modify GPS coordinates or other fields
- Safe to run multiple times (idempotent)

---

## 🔑 Google OAuth Scripts

### `get-google-tokens.js`
Generates OAuth tokens for Google Business Profile API.

### `get-google-ids.js`
Retrieves Google Business Account and Location IDs.

### `check-google-apis.js`
Verifies Google API access and permissions.

**Note:** These scripts are part of the Google My Business integration (Phase 3) and may no longer be in active use after the Zapier pivot.

---

## 🛠️ Adding New Scripts

When creating new scripts:

1. **Naming:** Use kebab-case (e.g., `my-new-script.ts`)
2. **Shebang:** Add `#!/usr/bin/env tsx` for direct execution
3. **Documentation:** Add a header comment explaining purpose and usage
4. **Error Handling:** Use try/catch and exit codes
5. **Logging:** Use clear console output with emojis for status
6. **Environment:** Load from `.env.local` via process.env
7. **Type Safety:** Use TypeScript for new scripts

**Template:**

```typescript
#!/usr/bin/env tsx
/**
 * Script: My New Script
 * Purpose: Does something useful
 * Usage: npx tsx scripts/my-new-script.ts
 */

async function main() {
  console.log('🚀 Starting...')
  
  try {
    // Your code here
    console.log('✅ Success!')
  } catch (error) {
    console.error('❌ Error:', error)
    process.exit(1)
  }
}

main()
```

---

## 📚 Resources

- [Nominatim Usage Policy](https://operations.osmfoundation.org/policies/nominatim/)
- [Supabase Service Role Key](https://supabase.com/docs/guides/api#service-role-key)
- [tsx Documentation](https://github.com/esbuild-kit/tsx)
