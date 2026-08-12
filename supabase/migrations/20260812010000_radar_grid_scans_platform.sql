-- Which Google surface a grid scan measured. Applied remotely via Supabase MCP;
-- kept here for repo history.
--
-- These surfaces disagree with each other. Verified 2026-08-11 at
-- 38.8076,-104.7442: the local pack, organic (rank 34) and AI Overview all
-- placed us nowhere, while AI Mode named five competitors. A scan row without
-- a platform is therefore ambiguous -- hence NOT NULL with a backfilled
-- default of google_maps for all historical scans.
ALTER TABLE public.radar_grid_scans
  ADD COLUMN IF NOT EXISTS platform text NOT NULL DEFAULT 'google_maps';

CREATE INDEX IF NOT EXISTS radar_grid_scans_platform_created_idx
  ON public.radar_grid_scans (platform, created_at DESC);
