-- Weekly Google Search Console ranking-baseline snapshots. The
-- gsc-ranking-baseline cron stores site-wide 28-day totals and a fixed
-- watchlist of priority unbranded keywords each week, so week-over-week and
-- month-over-month trend can be computed by diffing against prior rows.
create table if not exists gsc_ranking_snapshots (
  id uuid primary key default gen_random_uuid(),
  property text not null,
  window_days integer not null,
  clicks integer not null,
  impressions integer not null,
  ctr numeric not null,
  avg_position numeric not null,
  checked_at timestamptz not null default now()
);

create index if not exists gsc_ranking_snapshots_property_idx
  on gsc_ranking_snapshots (property, checked_at desc);

alter table gsc_ranking_snapshots enable row level security;

create table if not exists gsc_keyword_snapshots (
  id uuid primary key default gen_random_uuid(),
  property text not null,
  keyword text not null,
  page text,
  clicks integer not null,
  impressions integer not null,
  avg_position numeric not null,
  checked_at timestamptz not null default now()
);

create index if not exists gsc_keyword_snapshots_keyword_idx
  on gsc_keyword_snapshots (keyword, checked_at desc);

alter table gsc_keyword_snapshots enable row level security;
