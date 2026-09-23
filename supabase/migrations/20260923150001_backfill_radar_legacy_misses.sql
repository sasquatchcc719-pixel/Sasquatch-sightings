-- The legacy SerpApi scanner stored 50 both for a genuine #50 result and for
-- "not present in the short result page we received." Those meanings cannot be
-- separated after the fact, and treating the sentinel as a measured rank makes
-- historical charts look more certain than the source data was.
--
-- Preserve actual observed legacy placements (1-49), but convert the fake
-- sentinel to the repaired schema's explicit unknown/not-found representation.
update public.radar_rankings
set rank_position = null
where scan_run_id is null
  and rank_position = 50;
