-- Weekly Google Search Console index-coverage snapshots. The gsc-watch cron
-- inspects key URLs weekly, stores results here, and diffs against the prior
-- run to detect regressions (indexed pages dropping out) and wins.
create table if not exists gsc_page_snapshots (
  id uuid primary key default gen_random_uuid(),
  property text not null,
  url text not null,
  coverage text,
  verdict text,
  last_crawl_at timestamptz,
  checked_at timestamptz not null default now()
);

create index if not exists gsc_page_snapshots_url_idx
  on gsc_page_snapshots (url, checked_at desc);
create index if not exists gsc_page_snapshots_checked_idx
  on gsc_page_snapshots (checked_at desc);

alter table gsc_page_snapshots enable row level security;
