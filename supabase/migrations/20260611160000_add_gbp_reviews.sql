-- Google Business Profile reviews, synced daily via SerpApi. Used to skip
-- review requests for customers who already reviewed, and to notify Charles
-- of new reviews.
create table if not exists gbp_reviews (
  id uuid primary key default gen_random_uuid(),
  review_id text not null unique,
  author text,
  rating numeric,
  snippet text,
  review_date_label text,
  first_seen_at timestamptz not null default now()
);

create index if not exists gbp_reviews_author_idx on gbp_reviews (lower(author));

alter table gbp_reviews enable row level security;
