-- Migration: Add city and state columns to sightings table
-- Date: 2026-01-19
-- Purpose: Enable location-specific Open Graph tags and SEO for sighting share pages

-- Add city and state columns
ALTER TABLE sightings ADD COLUMN IF NOT EXISTS city TEXT;
ALTER TABLE sightings ADD COLUMN IF NOT EXISTS state TEXT;

-- Add index for city queries (for future filtering/search)
CREATE INDEX IF NOT EXISTS idx_sightings_city ON sightings(city) WHERE city IS NOT NULL;

-- Add comment for documentation
COMMENT ON COLUMN sightings.city IS 'City name from reverse geocoding (Nominatim)';
COMMENT ON COLUMN sightings.state IS 'State abbreviation (e.g., CO) from reverse geocoding';
