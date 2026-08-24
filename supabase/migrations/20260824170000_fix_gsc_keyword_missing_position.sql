-- A watchlist keyword with no impressions was stored as avg_position = 0, which
-- is indistinguishable from real data. The next week's comparison then read 0
-- as "position zero" and reported a keyword returning at #5 as a 5-place LOSS.
-- Missing position is now null, and the historical zero rows are corrected so
-- trend math can tell "no data" apart from "ranked".

alter table gsc_keyword_snapshots
  alter column avg_position drop not null;

update gsc_keyword_snapshots
set avg_position = null
where impressions = 0
  and avg_position = 0;

comment on column gsc_keyword_snapshots.avg_position is
  'Average Google position over the window. NULL when the keyword had no impressions — never 0.';
