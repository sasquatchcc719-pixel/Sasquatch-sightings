create table if not exists public.booking_error_events (
  id uuid primary key default gen_random_uuid(),
  session_id text not null
    check (char_length(session_id) between 3 and 64),
  stage text not null
    check (stage in ('services', 'calendar', 'times', 'submit')),
  error_message text not null,
  http_status integer
    check (http_status is null or http_status between 0 and 599),
  quote_total numeric(10, 2) not null default 0,
  item_count integer not null default 0
    check (item_count >= 0),
  appointment_date date,
  customer_name text,
  customer_phone text,
  customer_email text,
  referrer text,
  landing_path text,
  user_agent text,
  metadata jsonb not null default '{}'::jsonb,
  occurrence_count integer not null default 1
    check (occurrence_count >= 1),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  recovered_at timestamptz,
  appointment_id uuid references public.ops_appointments(id) on delete set null,
  alert_sent_at timestamptz,
  alert_error text,
  unique (session_id, stage)
);

create index if not exists booking_error_events_last_seen_idx
  on public.booking_error_events (last_seen_at desc);
create index if not exists booking_error_events_unrecovered_idx
  on public.booking_error_events (last_seen_at desc)
  where recovered_at is null;

alter table public.booking_error_events enable row level security;

revoke all on table public.booking_error_events from anon, authenticated;
grant select, insert, update, delete
  on table public.booking_error_events to service_role;

comment on table public.booking_error_events is
  'Blocking sasquatchcarpet.com booking-widget failures, deduplicated by browser session and stage for owner alerts.';
comment on column public.booking_error_events.recovered_at is
  'Set when the same browser session subsequently books successfully.';
