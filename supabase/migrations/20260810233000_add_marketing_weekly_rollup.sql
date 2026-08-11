-- One reconciled marketing row per Monday-Sunday week and market.
-- `business-wide` holds metrics that cannot honestly be assigned to a town;
-- `unknown` keeps bad/missing address joins visible instead of dropping them.
create table if not exists public.marketing_weekly_rollup (
  week_start date not null,
  week_end date not null,
  town_slug text not null,
  spend numeric(12,2) not null default 0,
  rank_best numeric(5,2),
  rank_median numeric(5,2),
  rank_points integer not null default 0,
  rank_found integer not null default 0,
  gsc_impressions integer not null default 0,
  gsc_clicks integer not null default 0,
  gsc_data_through date,
  quote_sessions integer not null default 0,
  residential_jobs integer not null default 0,
  residential_revenue numeric(12,2) not null default 0,
  commercial_jobs integer not null default 0,
  commercial_revenue numeric(12,2) not null default 0,
  review_delta integer,
  events jsonb not null default '[]'::jsonb,
  built_at timestamptz not null default now(),
  primary key (week_start, town_slug),
  constraint marketing_weekly_rollup_week_check
    check (week_end = week_start + 6),
  constraint marketing_weekly_rollup_town_check check (town_slug in (
    'business-wide', 'unknown', 'palmer-lake', 'monument', 'woodmoor',
    'gleneagle', 'larkspur', 'castle-rock', 'castle-pines', 'black-forest',
    'colorado-springs', 'falcon', 'peyton', 'fountain', 'manitou-springs'
  )),
  constraint marketing_weekly_rollup_money_check check (
    spend >= 0 and residential_revenue >= 0 and commercial_revenue >= 0
  ),
  constraint marketing_weekly_rollup_counts_check check (
    rank_points >= 0 and rank_found >= 0 and rank_found <= rank_points and
    gsc_impressions >= 0 and gsc_clicks >= 0 and quote_sessions >= 0 and
    residential_jobs >= 0 and commercial_jobs >= 0
  ),
  constraint marketing_weekly_rollup_rank_check check (
    (rank_best is null or rank_best between 1 and 20) and
    (rank_median is null or rank_median between 1 and 21)
  ),
  constraint marketing_weekly_rollup_gsc_window_check check (
    gsc_data_through is null or
    gsc_data_through between week_start and week_end
  ),
  constraint marketing_weekly_rollup_events_check check (
    jsonb_typeof(events) = 'array'
  )
);

create index if not exists marketing_weekly_rollup_week_idx
  on public.marketing_weekly_rollup (week_start desc);

alter table public.marketing_weekly_rollup enable row level security;

comment on table public.marketing_weekly_rollup is
  'Monday-Sunday marketing intelligence by canonical town. Refreshed by the weekly rollup worker.';
comment on column public.marketing_weekly_rollup.spend is
  'Campaign costs in this week. Cross-town costs are split once; business-wide costs live only on the business-wide row.';
comment on column public.marketing_weekly_rollup.rank_median is
  'Median Maps rank across Radar Grid and Local Falcon points; not-found points count as 21.';
comment on column public.marketing_weekly_rollup.rank_found is
  'Points where Sasquatch was found in the Maps top 20. Read with rank_points as coverage.';
comment on column public.marketing_weekly_rollup.gsc_data_through is
  'Last date included from Search Console; recent weeks lag Google by three days.';
comment on column public.marketing_weekly_rollup.review_delta is
  'Change from the last Google review snapshot before the week to the last snapshot in the week; NULL when no baseline exists.';
