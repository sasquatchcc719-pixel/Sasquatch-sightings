-- Phase 1: Add geocoding columns to ops_service_addresses
-- Nominatim forward-geocode (address → lat/lng) will backfill existing rows
-- and auto-populate new rows via the application layer.

ALTER TABLE ops_service_addresses
  ADD COLUMN IF NOT EXISTS latitude  DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS geocoded_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS geocode_source TEXT;

CREATE INDEX IF NOT EXISTS idx_ops_service_addresses_geocoded
  ON ops_service_addresses (geocoded_at)
  WHERE geocoded_at IS NULL;
