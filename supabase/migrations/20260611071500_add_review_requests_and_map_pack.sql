-- Review request engine: one row per completed appointment we ask a Google
-- review for. The cron enqueues from completed appointments and sends via
-- Twilio inside a Mountain Time send window.
create table if not exists review_requests (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null unique references ops_appointments(id) on delete cascade,
  customer_id uuid references ops_customers(id) on delete set null,
  phone text,
  status text not null default 'pending', -- pending | sent | skipped | failed
  skip_reason text,
  scheduled_for timestamptz not null,
  sent_at timestamptz,
  message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists review_requests_due_idx
  on review_requests (status, scheduled_for);
create index if not exists review_requests_customer_idx
  on review_requests (customer_id, sent_at);

alter table review_requests enable row level security;

-- Radar: persist the full Google Maps local pack per keyword scan (SerpApi
-- already returns it; we previously discarded everything but our own rank).
-- History is kept so review-count gaps vs competitors are trackable over time.
create table if not exists radar_map_pack_snapshots (
  id uuid primary key default gen_random_uuid(),
  keyword_id uuid not null references radar_keywords(id) on delete cascade,
  position integer not null,
  title text,
  domain text,
  rating numeric,
  reviews integer,
  address text,
  created_at timestamptz not null default now()
);

create index if not exists radar_map_pack_keyword_idx
  on radar_map_pack_snapshots (keyword_id, created_at desc);

alter table radar_map_pack_snapshots enable row level security;
