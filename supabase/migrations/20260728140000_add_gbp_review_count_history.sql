-- The daily GBP sync already receives Google's public review total in
-- place_info.reviews, but only ever interpolated it into a Telegram message
-- and threw it away. With the business profile suspended and being reinstated,
-- that number is the clearest signal of whether Google has restored the review
-- history — so keep a daily snapshot and make the recovery visible.
--
-- Costs no extra SerpApi credits: this is the same one-call-per-day response
-- we already pay for, persisted instead of discarded.

create table if not exists gbp_review_counts (
  id uuid primary key default gen_random_uuid(),
  captured_on date not null unique,
  -- What Google publicly reports on the listing (the number that collapsed
  -- when the profile was suspended, and should climb back on reinstatement).
  total_on_google int,
  -- How many individual reviews we have archived locally. Our table only ever
  -- adds, so this is the floor of what existed and survives a takedown.
  stored_reviews int not null default 0,
  captured_at timestamptz not null default now()
);

alter table gbp_review_counts enable row level security;

create index if not exists idx_gbp_review_counts_day
  on gbp_review_counts (captured_on desc);
