-- Add Local Map Pack rank to radar_rankings (organic remains rank_position).
-- Run in Supabase SQL Editor if radar_rankings already exists.

ALTER TABLE radar_rankings
  ADD COLUMN IF NOT EXISTS map_rank INTEGER;

COMMENT ON COLUMN radar_rankings.rank_position IS 'Organic SERP position (1-based).';
COMMENT ON COLUMN radar_rankings.map_rank IS 'Local Map Pack position when present; NULL if not in pack.';
