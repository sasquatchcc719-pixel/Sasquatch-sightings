-- The weekly ranking report's keyword watchlist was a hardcoded array in
-- src/lib/gsc-ranking-baseline.ts, so changing what we track meant a deploy.
-- It lives here now and is editable from Marketing → Search Rankings.
--
-- Keywords are stored lowercase because that is how Search Console reports
-- them, and the report matches on an exact lowercase compare.
create table if not exists gsc_watchlist_keywords (
  id uuid primary key default gen_random_uuid(),
  keyword text not null,
  property text not null default 'https://www.sasquatchcarpet.com/',
  active boolean not null default true,
  notes text,
  -- Set once history has been pulled back from Google, so the UI can say
  -- whether a keyword's trend is real or still filling in.
  backfilled_at timestamptz,
  created_at timestamptz not null default now(),
  unique (keyword, property)
);

create index if not exists gsc_watchlist_keywords_active_idx
  on gsc_watchlist_keywords (property, active);

alter table gsc_watchlist_keywords enable row level security;

-- Seed with the list that was in code, so the next cron run tracks exactly
-- what the last one did. backfilled_at is set because these already have
-- real snapshot history going back to 2026-07-02.
insert into gsc_watchlist_keywords (keyword, notes, backfilled_at)
values
  ('carpet cleaners colorado springs', 'Original 2026-07-02 baseline', now()),
  ('area rug cleaning near me', 'Original 2026-07-02 baseline', now()),
  ('best carpet cleaners in colorado springs', 'Original 2026-07-02 baseline', now()),
  ('best carpet cleaner in colorado springs', 'Original 2026-07-02 baseline', now()),
  ('carpet cleaner colorado springs', 'Original 2026-07-02 baseline', now()),
  ('briargate cleaning', 'Original 2026-07-02 baseline', now())
on conflict (keyword, property) do nothing;
