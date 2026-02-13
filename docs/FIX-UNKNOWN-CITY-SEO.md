# Sasquatch Sightings: Fix "Unknown" City for SEO

**Copy this document to the Sasquatch Sightings project** when implementing the fix.

---

## Problem

Jobs are being stored with `city: "Unknown"` when GPS data doesn't resolve to a specific city. This is bad for:

1. **SEO** — Search engines need real location names (Monument, Palmer Lake, Colorado Springs) to rank for local searches. "Unknown" provides no local SEO value.
2. **Trust** — Users seeing "Unknown" on the website and map looks unprofessional.
3. **Discovery** — Jobs can't be found or filtered by neighborhood/area when the city is Unknown.

**Requirement:** "Unknown" can never be an option. We need to show a real location—even if it's a best guess or broader area. Better to be slightly wrong than to show Unknown.

---

## Solution (Two Parts)

### Part 1: Backfill Existing Jobs

For jobs that already have GPS coordinates but `city = "Unknown"`:

1. **Reverse geocode** — Use the stored lat/lng to look up the city via a geocoding API (e.g., OpenStreetMap Nominatim, Google Geocoding, Mapbox).
2. **Update the database** — Replace "Unknown" with the resolved city for each job.
3. **Fallback for failed lookups** — If reverse geocode fails or returns nothing useful, use a default like:
   - "Tri-Lakes Area"
   - "Colorado Springs Area"
   - "El Paso County, CO"
   - Or the nearest known city from a list of service areas

**Implementation idea:** A one-time migration script that:
- Queries jobs where `city = 'Unknown'` AND lat/lng exists
- Calls reverse geocode for each
- Updates the job record with the resolved city (or fallback)
- Logs any failures for manual review

---

### Part 2: Improve Job Creation Logic

When creating new jobs, the city resolution flow should be:

1. **GPS available and resolves** → Use the city from reverse geocode.
2. **GPS available but doesn't resolve** → Use a broader fallback (e.g., "Colorado Springs Area", "Tri-Lakes Area") based on:
   - Which service area/region the coordinates fall into
   - A lookup table of coordinates → region
   - Or simply "Colorado" as last resort
3. **GPS not available** → Require manual city selection (dropdown or text field) before the job can be saved. Never allow saving with "Unknown".
4. **Never store "Unknown"** — Add validation: if city would be Unknown, use a fallback instead.

**Suggested fallback hierarchy:**
1. Exact city from reverse geocode
2. "Tri-Lakes Area" (if coords are in that region)
3. "Colorado Springs Area"
4. "Northern Colorado"
5. "Colorado" (absolute last resort)

---

## Technical Notes

- **Geocoding APIs:** OpenStreetMap Nominatim is free. Google/Mapbox have better accuracy but may have usage limits.
- **Service area boundaries:** If you have defined polygons or bounds for Monument, Palmer Lake, Black Forest, etc., you could map coords → city without an external API.
- **Database:** Ensure the `city` (or equivalent) field is updated in the jobs table. Check if there are related fields (neighborhood, region) that also need population.

---

## Acceptance Criteria

- [ ] No job in the database has `city = "Unknown"` (after backfill)
- [ ] New jobs never save with "Unknown" — validation or fallback prevents it
- [ ] Backfill script run successfully on existing Unknown jobs
- [ ] Website and map display real location names for all jobs

---

## Related

- sasquatch.com-client now displays live jobs from Sightings on the Gallery and Standard Carpet Cleaning pages
- Jobs with "Unknown" appear on the live site — fixing this improves SEO and trust for the main website too
