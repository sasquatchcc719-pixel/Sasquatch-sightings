-- Add Google rating and review count to snapshot (from local pack when present).
-- Run this if radar_serp_snapshots already exists.

ALTER TABLE radar_serp_snapshots
  ADD COLUMN IF NOT EXISTS rating NUMERIC(2,1),
  ADD COLUMN IF NOT EXISTS reviews INTEGER,
  ADD COLUMN IF NOT EXISTS address TEXT;
